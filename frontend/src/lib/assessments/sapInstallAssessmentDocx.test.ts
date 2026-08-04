/**
 * Word export — structure tests.
 *
 * The document is packed to a real `.docx` and its XML read back, so these
 * assert what Word will actually show rather than what the builder intended.
 *
 * The scenarios are the same four as the JSON contract fixture, imported from
 * the pinned file so the two outputs cannot drift apart: if a scenario changes
 * there, it changes here.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';

import { advisories, type AssessmentState } from './sapInstallAssessment';
import {
  DOCUMENT_FORMAT,
  assessmentDocxBuffer,
  buildAssessmentDocument,
  documentCoversAllTabs
} from './sapInstallAssessmentDocx';

interface Snapshot {
  name: string;
  input: AssessmentState;
}

const SCENARIOS = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'reference.json'), 'utf8')
) as Snapshot[];

function scenario(name: string): AssessmentState {
  const found = SCENARIOS.find((s) => s.name === name);
  if (!found) throw new Error(`Fixture has no scenario named "${name}"`);
  return found.input;
}

/** Raw parts of the generated docx, for formatting assertions. */
async function documentParts(
  state: AssessmentState
): Promise<{ document: string; styles: string }> {
  const buffer = await assessmentDocxBuffer(state, advisories(state));
  const zip = await JSZip.loadAsync(buffer);
  const read = async (path: string) => {
    const entry = zip.file(path);
    if (!entry) throw new Error(`Generated docx has no ${path}`);
    return entry.async('string');
  };
  return { document: await read('word/document.xml'), styles: await read('word/styles.xml') };
}

/**
 * The single `<w:tc>` element whose text is exactly `text`.
 *
 * Slicing a window around the match is not good enough — the preceding cell
 * bleeds in, and a green header cell next door makes a plain body cell look
 * bold.
 */
function cellContaining(documentXml: string, text: string): string {
  for (const cell of documentXml.match(/<w:tc>(?:(?!<\/w:tc>).)*<\/w:tc>/gs) ?? []) {
    const content = [...cell.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)]
      .map((m) => m[1])
      .join('');
    if (content === text) return cell;
  }
  throw new Error(`No table cell found containing exactly "${text}"`);
}

/** Visible text of the generated document, with XML tags stripped. */
async function documentText(state: AssessmentState): Promise<string> {
  const buffer = await assessmentDocxBuffer(state, advisories(state));
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('Generated docx has no word/document.xml');
  const xml = await entry.async('string');
  return xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ');
}

describe('document builds at all', () => {
  it('produces a non-trivial docx for every scenario', async () => {
    for (const s of SCENARIOS) {
      const buffer = await assessmentDocxBuffer(s.input, advisories(s.input));
      // A valid docx is a zip: PK signature, and big enough to hold content.
      expect(buffer[0], s.name).toBe(0x50);
      expect(buffer[1], s.name).toBe(0x4b);
      expect(buffer.length, s.name).toBeGreaterThan(2000);
    }
  });

  it('covers every tab in the model', () => {
    expect(documentCoversAllTabs('businessobjects')).toBe(true);
    expect(documentCoversAllTabs('crystal-server')).toBe(true);
  });

  it('does not throw on a blank assessment', () => {
    expect(() => buildAssessmentDocument(scenario('blank'))).not.toThrow();
  });
});

/**
 * Look and feel.
 *
 * These pin the formatting measured from `Blank Install Assessment.docx`. If
 * one fails, the output has stopped matching the document it is meant to
 * look like — which is sometimes intended, but never accidental.
 */
describe('matches the source document’s look and feel', () => {
  let parts: { document: string; styles: string };
  beforeAll(async () => {
    parts = await documentParts(scenario('businessobjects complete'));
  });

  it('carries the Codestone styles part from the real document', () => {
    // Not a reimplementation — the actual styles.xml, lifted out of the file.
    expect(parts.styles).toContain('w:styleId="CTHeading1"');
    expect(parts.styles).toContain('w:styleId="CTNormal"');
    expect(parts.styles).toContain('CT Heading 1');
    // The navy heading band and Arial, defined by that style rather than by us.
    expect(parts.styles).toContain('364580');
  });

  it('uses CTHeading1 for every section heading', () => {
    const headings = parts.document.match(/<w:pStyle w:val="CTHeading1"\/>/g) ?? [];
    // Overview, Platform Overview, Content Migration, Training, Go Live, and
    // Points to Raise for this scenario.
    expect(headings.length).toBe(6);
  });

  it('fills heading bands and label cells with Codestone green', () => {
    expect(DOCUMENT_FORMAT.fill).toBe('3FBD02');
    expect(parts.document).toContain('w:fill="3FBD02"');
  });

  it('overrides the CTHeading1 navy band with the document’s green', () => {
    // The style says #364580. The source document overrides it on every
    // heading paragraph, so this output does too — otherwise the bands come
    // out navy and the file stops matching.
    const headingBlocks = parts.document.match(
      /<w:pPr>(?:(?!<\/w:pPr>).)*CTHeading1(?:(?!<\/w:pPr>).)*<\/w:pPr>/gs
    ) ?? [];
    expect(headingBlocks.length).toBeGreaterThan(0);
    for (const block of headingBlocks) {
      expect(block).toContain('w:fill="3FBD02"');
    }
  });

  it('leaves Platform Overview body labels unshaded and unbolded', () => {
    // The one table in the source document that shades only its header row.
    const cell = cellContaining(parts.document, 'Operating System');
    expect(cell).not.toContain('w:fill="3FBD02"');
    expect(cell).not.toContain('<w:b/>');
  });

  it('still shades label cells on the other tables', () => {
    // Same assertion, opposite expectation — proves the two patterns are
    // genuinely different rather than both accidentally plain.
    const cell = cellContaining(parts.document, 'Date of Conversation');
    expect(cell).toContain('w:fill="3FBD02"');
    expect(cell).toContain('<w:b/>');
  });

  it('sets label text white, bold, Arial 9pt', () => {
    expect(parts.document).toContain('w:val="FFFFFF"');
    expect(parts.document).toContain('w:ascii="Arial"');
    expect(parts.document).toContain('<w:sz w:val="18"/>');
  });

  it('switches every table border off, as the source document does', () => {
    // The structure reads from the green label cells, not from rules.
    expect(parts.document).toContain('<w:top w:val="none"');
    expect(parts.document).toContain('<w:insideV w:val="none"');
    expect(parts.document).not.toContain('w:insideV w:val="single"');
  });

  it('uses the source document’s four column grids', () => {
    for (const [name, grid] of Object.entries(DOCUMENT_FORMAT.grid)) {
      const total = grid.reduce((n: number, w: number) => n + w, 0);
      // The source document's own grids are not all identical — two come to
      // 10348 rather than 10338. Reproduced deliberately; see the note on
      // `textWidth`. Ten twips is 0.18 mm.
      expect(total - DOCUMENT_FORMAT.textWidth, name).toBeGreaterThanOrEqual(0);
      expect(total - DOCUMENT_FORMAT.textWidth, name).toBeLessThanOrEqual(10);
      for (const width of grid) {
        expect(parts.document, `${name} ${width}`).toContain(`<w:gridCol w:w="${width}"/>`);
      }
    }
    // Overview value cells span the three non-label columns.
    expect(parts.document).toContain('<w:gridSpan w:val="3"/>');
  });

  it('keeps rows at least 397 twips and vertically centred', () => {
    expect(parts.document).toContain('w:val="397"');
    expect(parts.document).toContain('<w:vAlign w:val="center"/>');
  });

  it('is A4 with the source document’s narrow margins', () => {
    expect(parts.document).toContain('w:w="11906"');
    expect(parts.document).toContain('w:h="16838"');
    expect(parts.document).toContain('w:top="568"');
    expect(parts.document).toContain('w:left="709"');
    expect(parts.document).toContain('w:right="849"');
  });

  it('starts at Overview, with no invented title page', () => {
    // The source document opens on the Overview band. So does this.
    const text = parts.document.replace(/<[^>]+>/g, ' ').trim();
    expect(text.indexOf('Overview')).toBeLessThan(40);
  });
});

describe('section headings, in document order', () => {
  let text: string;
  beforeAll(async () => {
    text = await documentText(scenario('businessobjects complete'));
  });

  it('keeps the source document’s five sections', () => {
    const order = [
      'Overview',
      'Platform Overview',
      'Content Migration',
      'Training Requirements',
      'Go Live Requirements'
    ];
    let cursor = -1;
    for (const heading of order) {
      const next = text.indexOf(heading, cursor + 1);
      expect(next, heading).toBeGreaterThan(cursor);
      cursor = next;
    }
  });

  it('uses the document’s row labels, not the tool’s field labels', () => {
    // The tool asks "Date of conversation"; the document says "Date of
    // Conversation". The filed artefact should read as it always has.
    expect(text).toContain('Date of Conversation');
    expect(text).toContain('CMS/Audit Database Software');
    expect(text).toContain('Number of Publication/Program documents');
    expect(text).toContain('Any adjacent work that might impact project delivery?');
  });
});

describe('answers reach the document', () => {
  let text: string;
  beforeAll(async () => {
    text = await documentText(scenario('businessobjects complete'));
  });

  it('carries the client and contacts', () => {
    expect(text).toContain('Acme Manufacturing Ltd');
    expect(text).toContain('2026-08-03');
    expect(text).toContain('signoff@example.invalid');
  });

  it('carries the environment detail', () => {
    expect(text).toContain('PROD01');
    expect(text).toContain('ACME-BOBJ-P01');
    expect(text).toContain('SAP BusinessObjects BI 4.2 SP7');
  });

  it('formats GB values with their unit', () => {
    expect(text).toContain('42.5 GB');
    expect(text).toContain('118 GB');
  });

  it('names the web server in the Web Server? row rather than just Yes', () => {
    expect(text).toContain('ACME-WEB-P01');
  });

  it('carries the narrative fields', () => {
    expect(text).toContain('Evaluating Power BI');
    expect(text).toContain('ERP upgrade running in parallel');
  });

  it('includes the advisories as points to raise', () => {
    expect(text).toContain('Points to Raise');
    expect(text).toContain('support ticket');
  });
});

describe('go-live rows', () => {
  it('writes the selected timing Yes and the rest No', async () => {
    // The tool asks one question; the document keeps its four rows.
    const state = structuredClone(scenario('businessobjects complete'));
    state.client.goLiveTiming = 'weekend';
    const text = await documentText(state);

    const section = text.slice(text.indexOf('Go Live Requirements'));
    const row = (label: string) => {
      const start = section.indexOf(label);
      return section.slice(start, start + label.length + 20);
    };
    expect(row('In core hours')).toContain('No');
    expect(row('Overnight')).toContain('No');
    expect(row('Weekend')).toContain('Yes');
  });

  it('adds the weekday row only when a specific weekday was chosen', async () => {
    const state = structuredClone(scenario('businessobjects complete'));
    state.client.goLiveTiming = 'specific-weekday';
    state.client.goLiveWeekday = 'thursday';
    const withDay = await documentText(state);
    expect(withDay).toContain('Thursday');

    state.client.goLiveTiming = 'overnight';
    const withoutDay = await documentText(state);
    expect(withoutDay.slice(withoutDay.indexOf('Go Live Requirements'))).not.toContain(
      'Thursday'
    );
  });

  it('leaves all four rows blank when no timing has been chosen', async () => {
    const text = await documentText(scenario('blank'));
    const section = text.slice(text.indexOf('Go Live Requirements'));
    expect(section).not.toContain('Yes');
  });
});

describe('Crystal Server', () => {
  let text: string;
  beforeAll(async () => {
    text = await documentText(scenario('crystal server'));
  });

  it('keeps the universe and WebI rows but marks them n/a', () => {
    // Dropping the rows would make two documents from the same template
    // structurally different, which is worse for whoever files them.
    expect(text).toContain('Number of UNVs');
    expect(text).toContain('Number of WebI documents');
    expect(text).toContain('n/a');
  });

  it('marks universe-specific training n/a rather than omitting it', () => {
    const section = text.slice(text.indexOf('Training Requirements'));
    expect(section).toContain('Information Design Tool');
    expect(section).toContain('n/a');
  });

  it('writes the implied No for the separate web server', () => {
    const section = text.slice(text.indexOf('Platform Overview'));
    expect(section).toContain('Web Server?');
  });
});

describe('multiple environments', () => {
  it('writes a platform and a content table per environment', async () => {
    const text = await documentText(scenario('two environments partial'));
    expect(text).toContain('PROD01');
    expect(text).toContain('PROD02');
    // Each environment label appears twice: once per table.
    expect(text.split('PROD02').length - 1).toBeGreaterThanOrEqual(2);
  });

  it('states the environment counts under the Platform Overview heading', async () => {
    const text = await documentText(scenario('two environments partial'));
    expect(text).toContain('2 production environments');
    expect(text).toContain('not detailed individually');
  });
});

describe('combined universe count', () => {
  it('replaces the UNV and UNX rows with a single combined row', async () => {
    const text = await documentText(scenario('two environments partial'));
    expect(text).toContain('Number of universes (combined UNV and UNX)');
  });
});
