/**
 * SAP Pre-Sales Install Assessment — Word output.
 *
 * Produces a `.docx` that looks like `Blank Install Assessment.docx` filled
 * in: the same sections in the same order, the same row labels, the same
 * green heading bands and label cells, on the same page setup and the same
 * column grids.
 *
 * ## Why this generates rather than patches a template
 *
 * The obvious alternative is to ship the `.docx` as a template and fill
 * placeholders (`docx` has `patchDocument`). Rejected: the document repeats
 * two whole tables **per production environment**, and several rows are
 * conditional — universes collapse to a combined row, Crystal Server rows
 * read `n/a`, narrative rows appear only when there is narrative. Placeholder
 * patching does not repeat or omit table rows, so the template would need a
 * fixed maximum number of environments and a blank-but-present fallback for
 * every conditional row.
 *
 * Instead the structure is generated and the **styling comes from the real
 * document**: `templates/install-assessment.styles.xml` is the styles part
 * lifted straight out of the source file and handed to `docx` as
 * `externalStyles`.
 *
 * ## Everything in LAYOUT was measured, not chosen
 *
 * The styles part cannot carry table or page formatting — those are
 * properties of each table and section. So they are transcribed here from the
 * source document, and the tests assert them against the generated XML.
 *
 * Two things that look like mistakes and are not:
 *
 * 1. **Headings are green, not navy.** The `CTHeading1` style defines a navy
 *    `#364580` band, but the source document overrides it with a direct green
 *    fill on every heading paragraph. The document wins.
 * 2. **The Platform Overview table shades only its header row.** Its body
 *    labels are plain, unbolded Arial. Every other table shades its whole
 *    label column. Four tables, four different grids — that is what the
 *    source file does.
 *
 * See AD-13.
 */

import {
  Document,
  HeightRule,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType
} from 'docx';

import {
  GO_LIVE_DOCUMENT_ROWS,
  TABS,
  type Field,
  type InstallationType
} from '../../config/sapInstallAssessmentModel';
import {
  impliedValues,
  installationTypeOf,
  isTabVisible,
  visibleFields,
  type Answers,
  type AssessmentState,
  type EnvironmentState
} from './sapInstallAssessment';
// The styles part of the source document, verbatim. Replacing this one file
// rebrands the output — see AD-13.
import externalStyles from './templates/install-assessment.styles.xml?raw';

/** Formatting transcribed from `Blank Install Assessment.docx`. */
const LAYOUT = {
  /** Codestone green. Heading bands and label cells. */
  fill: '3FBD02',
  onFill: 'FFFFFF',
  font: 'Arial',
  /** Half-points: 18 = 9pt. */
  size: 18,
  /** Minimum row height in twips, on shaded-label tables. */
  rowHeight: 397,
  /**
   * Nominal text width.
   *
   * Note that the source document's own grids do **not** all sum to this —
   * `content` and `simple` come to 10348, ten twips over, almost certainly
   * from someone dragging a column border in Word. That is reproduced rather
   * than tidied: ten twips is 0.18 mm and invisible, and matching the file
   * exactly is worth more than internal neatness. Each table's width is taken
   * from its own grid, so nothing is stretched.
   */
  textWidth: 10338,
  /**
   * Column grids, per table. The source document uses a different one for
   * each shape of table.
   */
  grid: {
    /** Overview: narrow label, then three columns for the user-landscape row. */
    overview: [2547, 2597, 2597, 2597],
    /** Platform Overview: label plus value. Source had a third "Proposed Server" column, dropped in v2. */
    platform: [3446, 6892],
    /** Single full-width column, for the transition narrative. */
    full: [10338],
    /** Content Migration. */
    content: [4111, 6237],
    /** Training and Go Live. */
    simple: [4678, 5670]
  },
  page: {
    size: { width: 11906, height: 16838 },
    margin: { top: 568, right: 849, bottom: 709, left: 709 }
  },
  style: { heading: 'CTHeading1', note: 'CTNormal' }
} as const;

const NO_BORDERS = {
  top: { style: 'none', size: 0, color: 'auto' },
  bottom: { style: 'none', size: 0, color: 'auto' },
  left: { style: 'none', size: 0, color: 'auto' },
  right: { style: 'none', size: 0, color: 'auto' },
  insideHorizontal: { style: 'none', size: 0, color: 'auto' },
  insideVertical: { style: 'none', size: 0, color: 'auto' }
} as const;

const BLANK = '';

// ─── Value formatting ─────────────────────────────────────────────────

function fieldById(id: string): Field | undefined {
  for (const tab of TABS) {
    const field = tab.fields.find((f) => f.id === id);
    if (field) return field;
  }
  return undefined;
}

/**
 * A single answer as it should read in the document.
 *
 * Unanswered comes out as an empty cell rather than a dash — the document is
 * a form, and an empty cell is what an unanswered question looks like on one.
 */
function value(answers: Answers, id: string, type: InstallationType): string {
  const field = fieldById(id);
  if (!field) return BLANK;

  let raw = (answers[id] ?? '').trim();

  if (raw === '') {
    for (const tab of TABS) {
      if (!tab.fields.some((f) => f.id === id)) continue;
      raw = impliedValues(tab, type, answers)[id] ?? '';
    }
  }
  if (raw === '') return BLANK;

  if (field.kind === 'yesno') return raw === 'yes' ? 'Yes' : 'No';
  if (field.kind === 'gb') return `${raw} GB`;
  if (field.options) return field.options.find((o) => o.value === raw)?.label ?? raw;
  return raw;
}

// ─── Cells ────────────────────────────────────────────────────────────

type CellTone = 'label' | 'plain';

function paragraphs(text: string, tone: CellTone): Paragraph[] {
  const lines = text === '' ? [BLANK] : text.split('\n');
  return lines.map(
    (line) =>
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: line,
            font: LAYOUT.font,
            size: LAYOUT.size,
            ...(tone === 'label' ? { bold: true, color: LAYOUT.onFill } : {})
          })
        ]
      })
  );
}

function tableCell(
  text: string,
  tone: CellTone,
  width: number,
  columnSpan = 1
): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    ...(columnSpan > 1 ? { columnSpan } : {}),
    ...(tone === 'label'
      ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: LAYOUT.fill } }
      : {}),
    verticalAlign: VerticalAlign.CENTER,
    children: paragraphs(text, tone)
  });
}

function tableRow(children: TableCell[]): TableRow {
  return new TableRow({
    height: { value: LAYOUT.rowHeight, rule: HeightRule.ATLEAST },
    children
  });
}

/**
 * Borderless, fixed-grid table.
 *
 * The source document applies `TableGrid` and then switches every border off
 * — the structure reads from the green cells, not from rules.
 */
function buildTable(rows: TableRow[], grid: readonly number[]): Table {
  return new Table({
    rows,
    // From the grid rather than a constant — see the note on `textWidth`.
    width: { size: grid.reduce((n, w) => n + w, 0), type: WidthType.DXA },
    columnWidths: [...grid],
    borders: NO_BORDERS
  });
}

/**
 * A table whose whole label column is green — Overview, Content Migration,
 * Training, Go Live.
 */
function labelledTable(
  entries: Array<[string, string]>,
  grid: readonly number[],
  extraRows: TableRow[] = []
): Table {
  const valueWidth = grid.slice(1).reduce((n, w) => n + w, 0);
  const span = grid.length - 1;
  const rows = entries.map(([label, text]) =>
    tableRow([
      tableCell(label, 'label', grid[0]),
      tableCell(text, 'plain', valueWidth, span)
    ])
  );
  return buildTable([...rows, ...extraRows], grid);
}

// ─── Paragraphs ───────────────────────────────────────────────────────

/**
 * Full-width green band.
 *
 * `CTHeading1` supplies the white bold Arial; the green fill is a direct
 * override, exactly as the source document does it.
 */
function heading(text: string): Paragraph {
  return new Paragraph({
    text,
    style: LAYOUT.style.heading,
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: LAYOUT.fill }
  });
}

function note(text: string): Paragraph {
  return new Paragraph({ text, style: LAYOUT.style.note });
}

function spacer(): Paragraph {
  return new Paragraph({ text: BLANK, spacing: { after: 120 } });
}

// ─── Sections ─────────────────────────────────────────────────────────

function overviewSection(
  state: AssessmentState,
  type: InstallationType
): Array<Paragraph | Table> {
  const c = state.client;
  const v = (id: string) => value(c, id, type);
  const grid = LAYOUT.grid.overview;
  const isCrystal = type === 'crystal-server';

  const rows: TableRow[] = [
    ['Client', v('client')],
    ['Date of Conversation', v('conversationDate')],
    ['Sign-off Name', v('signOffName')],
    ['Sign-off Email', v('signOffEmail')],
    ['Technical Contact Name', v('technicalContactName')],
    ['Technical Contact Email', v('technicalContactEmail')]
  ].map(([label, text]) =>
    tableRow([
      tableCell(label, 'label', grid[0]),
      tableCell(text, 'plain', grid[1] + grid[2] + grid[3], 3)
    ])
  );

  // The source document's four-column user-landscape block.
  rows.push(
    tableRow([
      tableCell('User Landscape', 'label', grid[0]),
      tableCell('Consumers', 'label', grid[1]),
      tableCell('Universe Modifiers', 'label', grid[2]),
      tableCell('Report Modifiers', 'label', grid[3])
    ]),
    tableRow([
      tableCell(BLANK, 'label', grid[0]),
      tableCell(v('consumers'), 'plain', grid[1]),
      // Crystal Server has no universes, so the column says so rather than
      // leaving a blank that reads as "nobody".
      tableCell(isCrystal ? 'n/a' : v('universeModifiers'), 'plain', grid[2]),
      tableCell(v('reportModifiers'), 'plain', grid[3])
    ]),
    tableRow([
      tableCell('Any adjacent work that might impact project delivery?', 'label', grid[0]),
      tableCell((c.adjacentWork ?? '').trim(), 'plain', grid[1] + grid[2] + grid[3], 3)
    ])
  );

  return [heading('Overview'), buildTable(rows, grid)];
}

/**
 * Platform Overview — the one table that shades only its header row.
 */
function platformTable(environment: EnvironmentState, type: InstallationType): Table {
  const a = environment.answers;
  const v = (id: string) => value(a, id, type);
  const grid = LAYOUT.grid.platform;
  const serverName = (a.serverName ?? '').trim();

  const header = tableRow([
    tableCell(environment.label, 'label', grid[0]),
    tableCell(
      serverName === '' ? 'Current Server' : `Current Server ${serverName}`,
      'label',
      grid[1]
    )
  ]);

  const body: Array<[string, string]> = [
    ['Operating System', v('operatingSystem')],
    ['Platform Software', v('platformSoftware')],
    ['CMS/Audit Database Software', v('cmsDatabaseSoftware')],
    ['Authentication', v('authentication')],
    ['Separate Tomcat?', v('separateTomcat')],
    ['HTTPS?', v('httpsConfigured')],
    [
      'Web Server?',
      (a.separateWebServer ?? '') === 'yes'
        ? (a.webServerName ?? '').trim() || 'Yes'
        : v('separateWebServer')
    ],
    ['Externally Facing?', v('externallyFacing')],
    ['Clustered Environment?', v('clustered')],
    ['Auditing Currently Enabled?', v('auditingEnabled')]
  ];

  return buildTable(
    [
      header,
      ...body.map(([label, text]) =>
        // Plain, unbolded labels — the source document does not shade these.
        tableRow([
          tableCell(label, 'plain', grid[0]),
          tableCell(text, 'plain', grid[1])
        ])
      )
    ],
    grid
  );
}

function platformSection(
  state: AssessmentState,
  type: InstallationType
): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [heading('Platform Overview')];

  const test = (state.client.testEnvironmentCount ?? '').trim();
  const dev = (state.client.devEnvironmentCount ?? '').trim();
  const counts: string[] = [
    `${state.environments.length} production environment${state.environments.length === 1 ? '' : 's'}`
  ];
  if (state.client.hasTestEnvironments === 'yes') {
    counts.push(`${test || 'an unspecified number of'} test`);
  }
  if (state.client.hasDevEnvironments === 'yes') {
    counts.push(`${dev || 'an unspecified number of'} development`);
  }

  out.push(
    note(
      `Installation type: ${type === 'crystal-server' ? 'SAP Crystal Server' : 'SAP BusinessObjects'}. ${counts.join(', ')}. Test and development environments are rebuilt as a copy of the new production and are not detailed individually.`
    )
  );

  for (const environment of state.environments) {
    out.push(platformTable(environment, type), spacer());
  }

  // The source document's standalone transition table.
  out.push(
    buildTable(
      [
        tableRow([
          tableCell(
            'Transition to another toolset? Narrative summarisation',
            'label',
            LAYOUT.grid.full[0]
          )
        ]),
        tableRow([
          tableCell(
            (state.client.futureDirection ?? '').trim(),
            'plain',
            LAYOUT.grid.full[0]
          )
        ])
      ],
      LAYOUT.grid.full
    ),
    spacer()
  );

  return out;
}

function contentTable(environment: EnvironmentState, type: InstallationType): Table {
  const a = environment.answers;
  const v = (id: string) => value(a, id, type);
  const grid = LAYOUT.grid.content;
  const isCrystal = type === 'crystal-server';

  const entries: Array<[string, string]> = [
    [environment.label, BLANK],
    ['Input File Repository Folder size', v('inputFileRepositoryGb')],
    ['Output File Repository Folder size', v('outputFileRepositoryGb')]
  ];

  if (isCrystal) {
    entries.push(['Number of UNVs', 'n/a'], ['Number of UNXs', 'n/a']);
  } else if ((a.universeCountMode ?? '') === 'combined') {
    entries.push([
      'Number of universes (combined UNV and UNX)',
      v('combinedUniverseCount')
    ]);
  } else {
    entries.push(['Number of UNVs', v('unvCount')], ['Number of UNXs', v('unxCount')]);
  }

  entries.push(
    ['Number of Crystal documents', v('crystalDocuments')],
    ['Number of WebI documents', isCrystal ? 'n/a' : v('webiDocuments')],
    ['Number of Publication/Program documents', v('publications')],
    ['Total Pending Instances', v('pendingInstances')],
    ['Total Successful Instances', v('successfulInstances')],
    ['Changes to schedule destinations required?', v('destinationChangesRequired')]
  );

  if ((a.destinationChangesRequired ?? '') === 'yes') {
    entries.push(['What needs to change?', (a.destinationChangesNarrative ?? '').trim()]);
  }

  entries.push([
    'All successful instances required?',
    v('successfulInstancesRequired')
  ]);

  if ((a.successfulInstancesRequired ?? '') === 'some') {
    entries.push([
      'Which instances are required?',
      (a.successfulInstancesNarrative ?? '').trim()
    ]);
  }

  return labelledTable(entries, grid);
}

function contentSection(
  state: AssessmentState,
  type: InstallationType
): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [heading('Content Migration')];
  for (const environment of state.environments) {
    out.push(contentTable(environment, type), spacer());
  }
  return out;
}

function trainingSection(
  state: AssessmentState,
  type: InstallationType
): Array<Paragraph | Table> {
  const tab = TABS.find((t) => t.id === 'training')!;
  const shown = new Set(visibleFields(tab, type, state.client).map((f) => f.id));

  // Every training item keeps its row in document order. Items the platform
  // does not have read n/a rather than being dropped, so two assessments from
  // the same template are structurally the same document.
  const entries = tab.fields.map(
    (field): [string, string] => [
      field.label,
      shown.has(field.id) ? value(state.client, field.id, type) : 'n/a'
    ]
  );

  return [
    heading('Training Requirements'),
    labelledTable(entries, LAYOUT.grid.simple)
  ];
}

function goLiveSection(state: AssessmentState): Array<Paragraph | Table> {
  const selected = (state.client.goLiveTiming ?? '').trim();

  // The tool asks one question; the document keeps its four Yes/No rows. All
  // four stay blank until something is chosen, so an unanswered form does not
  // read as four deliberate Nos.
  const entries: Array<[string, string]> = GO_LIVE_DOCUMENT_ROWS.map((option) => [
    option.label,
    selected === '' ? BLANK : selected === option.value ? 'Yes' : 'No'
  ]);

  if (selected === 'specific-weekday') {
    const weekday = TABS.find((t) => t.id === 'go-live')!.fields.find(
      (f) => f.id === 'goLiveWeekday'
    );
    const raw = (state.client.goLiveWeekday ?? '').trim();
    entries.push([
      'Which day?',
      weekday?.options?.find((o) => o.value === raw)?.label ?? raw
    ]);
  }

  return [heading('Go Live Requirements'), labelledTable(entries, LAYOUT.grid.simple)];
}

/**
 * Not in the source document — added because these are the things that cost
 * money if they are not said out loud before the quote goes out.
 */
function pointsToRaiseSection(
  notes: Array<{ scope?: string; text: string }>
): Array<Paragraph | Table> {
  if (notes.length === 0) return [];
  return [
    heading('Points to Raise'),
    labelledTable(
      notes.map((n): [string, string] => [n.scope ?? 'General', n.text]),
      LAYOUT.grid.simple
    )
  ];
}

// ─── Document ─────────────────────────────────────────────────────────

/**
 * Build the assessment document.
 *
 * `notes` is the advisory list from `advisories()`, passed in rather than
 * recomputed so the Word output and the on-screen record cannot disagree.
 */
export function buildAssessmentDocument(
  state: AssessmentState,
  notes: Array<{ scope?: string; text: string }> = []
): Document {
  const type = installationTypeOf(state);
  const client = (state.client.client ?? '').trim() || 'Unnamed client';

  return new Document({
    externalStyles,
    creator: 'Codestone SMB Pre-Sales Portal',
    title: `SAP BI Platform Install Assessment — ${client}`,
    description: 'Pre-sales install assessment captured during the technical conversation.',
    sections: [
      {
        properties: { page: LAYOUT.page },
        children: [
          ...overviewSection(state, type),
          ...platformSection(state, type),
          ...contentSection(state, type),
          ...trainingSection(state, type),
          ...goLiveSection(state),
          ...pointsToRaiseSection(notes)
        ]
      }
    ]
  });
}

/** Browser path. Kept here so the page holds no docx knowledge. */
export async function assessmentDocxBlob(
  state: AssessmentState,
  notes: Array<{ scope?: string; text: string }> = []
): Promise<Blob> {
  return Packer.toBlob(buildAssessmentDocument(state, notes));
}

/** Node path, for tests. */
export async function assessmentDocxBuffer(
  state: AssessmentState,
  notes: Array<{ scope?: string; text: string }> = []
): Promise<Buffer> {
  return Packer.toBuffer(buildAssessmentDocument(state, notes));
}

/** Measured formatting, exported so the tests assert the real values. */
export const DOCUMENT_FORMAT = LAYOUT;

/** Guards against a tab being added to the model and never reaching the file. */
export function documentCoversAllTabs(type: InstallationType): boolean {
  const covered = new Set([
    'overview',
    'usage',
    'landscape',
    'server',
    'ccm',
    'cmc-settings',
    'cmc-universes',
    'cmc-contents',
    'cmc-schedules',
    'training',
    'go-live'
  ]);
  return TABS.filter((t) => isTabVisible(t, type)).every((t) => covered.has(t.id));
}
