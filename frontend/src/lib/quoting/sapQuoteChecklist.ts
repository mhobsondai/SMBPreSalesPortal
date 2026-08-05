/**
 * CheckList (.docx) writer.
 *
 * Fills `templates/blank-checklist.docx` by editing `word/document.xml`
 * directly, replacing `<<token>>` placeholders and expanding the list ones
 * into as many paragraphs as there are bullets.
 *
 * ── Why raw XML rather than the `docx` package ────────────────────────
 *
 * AD-13 rejected `patchDocument` for the install assessment because that
 * document repeats whole tables per environment and conditionally omits
 * rows, neither of which patching can do. **That reasoning does not apply
 * here** and should not be inherited: the CheckList is a fixed document with
 * eleven single-paragraph placeholders, which is exactly the shape patching
 * suits.
 *
 * The XML route is kept anyway, for one specific reason: each expanded
 * bullet must inherit the template paragraph's own `w:pPr` — including its
 * `w:numPr` list binding and indent level — so the bullets come out as the
 * template's list style rather than a reconstruction of it. Cloning the
 * paragraph properties from the file is the most direct way to guarantee
 * that, and it is what the prototype did.
 *
 * `jszip` is imported inside the function so it code-splits.
 */

import {
  CHECKLIST_PLACEHOLDERS,
  PM_LEVELS
} from '../../config/sapQuoteGeneratorModel';
import {
  formatPercent,
  resolveScope,
  type QuoteState,
  type QuoteTotals
} from './sapQuoteGenerator';

const DOCUMENT_PART = 'word/document.xml';

/** XML text escaping. Matches the prototype's `ex()`. */
export function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** A placeholder as it appears in the XML, i.e. already entity-escaped. */
function token(placeholder: string): string {
  return escapeXml(placeholder);
}

/**
 * Remove the invisible markers Word scatters between runs.
 *
 * `<w:proofErr/>` and the bookmark markers are self-closing and carry no
 * text, but they sit *between* `<w:r>` elements and so block run merging —
 * which is how `<<contact_name>>` ends up unreplaceable when Word has
 * flagged part of it as a spelling error.
 */
export function stripProofingMarkers(xml: string): string {
  return xml
    .replace(/<w:proofErr\b[^>]*\/>/g, '')
    .replace(/<w:bookmarkStart\b[^>]*\/>/g, '')
    .replace(/<w:bookmarkEnd\b[^>]*\/>/g, '');
}

/**
 * Collapse adjacent text runs so a placeholder split across runs becomes
 * contiguous and therefore replaceable.
 *
 * Iterated to a fixed point: one pass joins two runs, and a placeholder can
 * be split across more than two.
 */
export function mergeAdjacentRuns(xml: string): string {
  const pattern =
    /<\/w:t><\/w:r><w:r>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t(?:\s[^>]*)?>|<\/w:t><\/w:r><w:r><w:t(?:\s[^>]*)?>/g;
  let previous = '';
  let current = xml;
  while (current !== previous) {
    previous = current;
    current = current.replace(pattern, '');
  }
  return current;
}

interface Bullet {
  text: string;
  /** 0 for a heading-level bullet, 1 for an item nested beneath one. */
  level: number;
}

/**
 * Replace a placeholder paragraph with one paragraph per bullet, each
 * carrying the placeholder paragraph's own properties.
 *
 * The split/join on `</w:p>` is what makes this safe to do with strings: the
 * document is cut at paragraph boundaries, only the fragment containing the
 * placeholder is rewritten, and the closing tags are restored by the join.
 * An empty list collapses to a single empty paragraph rather than leaving
 * the token visible.
 */
export function expandPlaceholderParagraph(
  xml: string,
  placeholder: string,
  bullets: Bullet[]
): string {
  const marker = token(placeholder);
  return xml
    .split('</w:p>')
    .map((fragment) => {
      if (!fragment.includes(marker)) return fragment;

      const paragraphProperties = /(<w:pPr>[\s\S]*?<\/w:pPr>)/.exec(fragment)?.[1] ?? '';
      const runProperties = /(<w:rPr>[\s\S]*?<\/w:rPr>)/.exec(fragment)?.[1] ?? '';

      const atLevel = (level: number) =>
        paragraphProperties.replace(
          /<w:ilvl w:val="\d+"/,
          `<w:ilvl w:val="${level}"`
        );

      if (bullets.length === 0) {
        return `<w:p>${atLevel(0)}<w:r>${runProperties}<w:t></w:t></w:r>`;
      }

      return bullets
        .map(
          (bullet) =>
            `<w:p>${atLevel(bullet.level)}<w:r>${runProperties}` +
            `<w:t xml:space="preserve">${escapeXml(bullet.text)}</w:t></w:r>`
        )
        .join('</w:p>\n');
    })
    .join('</w:p>');
}

/**
 * The Inclusions block: each populated scope category as a level-0 heading
 * with its items nested beneath, then the PM tier and its deliverables.
 *
 * The PM tier is always present — every quote carries project management.
 */
export function inclusionBullets(state: QuoteState, totals: QuoteTotals): Bullet[] {
  const bullets: Bullet[] = [];
  for (const category of resolveScope(state)) {
    bullets.push({ text: category.label, level: 0 });
    for (const item of category.items) bullets.push({ text: item, level: 1 });
  }
  bullets.push({ text: totals.pmLabel, level: 0 });
  const level = PM_LEVELS.find((l) => l.id === totals.pmLevel);
  for (const deliverable of level?.deliverables ?? []) {
    bullets.push({ text: deliverable, level: 1 });
  }
  return bullets;
}

/**
 * Multi-line text as a single run with explicit breaks, so a typed brief
 * keeps its paragraph spacing.
 *
 * Nothing populates the brief in this pass — the AI generation step is not
 * built yet, so `<<project_brief>>` resolves to empty and the CheckList's
 * Introduction section comes out blank for the consultant to write into.
 * See AD-14.
 */
export function briefXml(brief: string): string {
  if (brief.trim() === '') return '';
  return escapeXml(brief).replace(
    /\n/g,
    '</w:t><w:br/><w:t xml:space="preserve">'
  );
}

export interface ChecklistContent {
  /** Currently always empty — see `briefXml`. */
  brief?: string;
}

/**
 * Fill the template and return the document bytes.
 *
 * `template` is the blank CheckList, either the bundled asset or a file the
 * consultant supplied to override it.
 */
export async function buildChecklist(
  template: ArrayBuffer,
  state: QuoteState,
  totals: QuoteTotals,
  content: ChecklistContent = {}
): Promise<ArrayBuffer> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(template);

  const part = zip.file(DOCUMENT_PART);
  if (!part) {
    throw new Error(
      `The selected document has no ${DOCUMENT_PART} — is it the blank CheckList template?`
    );
  }

  let xml = await part.async('string');
  xml = stripProofingMarkers(xml);
  xml = mergeAdjacentRuns(xml);

  const P = CHECKLIST_PLACEHOLDERS;

  const simple: Array<[string, string]> = [
    [P.ticket, escapeXml(state.ticket)],
    [P.customer, escapeXml(state.client)],
    [P.contactName, escapeXml(state.contactName)],
    [P.contactEmail, escapeXml(state.contactEmail)],
    [P.fixedTarget, escapeXml(state.pricingBasis)],
    [P.pmRate, escapeXml(formatPercent(totals.pmRate))],
    [P.projectBrief, briefXml(content.brief ?? '')]
  ];
  for (const [placeholder, value] of simple) {
    xml = xml.split(token(placeholder)).join(value);
  }

  const flat = (items: string[]): Bullet[] =>
    items
      .map((t) => t.trim())
      .filter((t) => t !== '')
      .map((text) => ({ text, level: 0 }));

  xml = expandPlaceholderParagraph(xml, P.dependencies, flat(state.dependencies));
  xml = expandPlaceholderParagraph(xml, P.assumptions, flat(state.assumptions));
  xml = expandPlaceholderParagraph(xml, P.outOfScope, flat(state.exclusions));
  xml = expandPlaceholderParagraph(xml, P.inScope, inclusionBullets(state, totals));

  zip.file(DOCUMENT_PART, xml);
  // DEFLATE, explicitly. JSZip stores uncompressed by default, and the
  // prototype took that default — which turned a 33 kB template into a
  // 298 kB document. Word opens either, but the file people file should not
  // be nine times the size of the one they started from.
  const out = await zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
  return out;
}
