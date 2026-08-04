/**
 * SAP Pre-Sales Install Assessment — Word output.
 *
 * Builds a `.docx` mirroring `Blank Install Assessment.docx`: the same five
 * headed sections, in the document's order, not the tool's tab order. The
 * tool reorders questions to suit the conversation; the document is what
 * gets filed, and it should look like the document people already know.
 *
 * ## Why this is client-side
 *
 * Generating it in the Functions API would mean POSTing the client name and
 * two sets of contact details to a Codestone server, giving this tool a
 * data-protection footprint it currently does not have — for nothing the
 * browser cannot do. See AD-11 and AD-12.
 *
 * ## Structure
 *
 * This module returns a `Document` and does not touch the DOM. The page
 * calls `Packer.toBlob()`; tests call `Packer.toBuffer()`. That keeps the
 * document structure testable in Node.
 */

import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx';

import {
  GO_LIVE_DOCUMENT_ROWS,
  TABS,
  type Field,
  type InstallationType
} from '../../config/sapInstallAssessmentModel';
import {
  installationTypeOf,
  impliedValues,
  isTabVisible,
  visibleFields,
  type Answers,
  type AssessmentState,
  type EnvironmentState
} from './sapInstallAssessment';

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
 * Unanswered comes out as an empty cell rather than a dash — the document
 * is a form, and a blank cell is what a blank form looks like.
 */
function value(answers: Answers, id: string, type: InstallationType): string {
  const field = fieldById(id);
  if (!field) return BLANK;

  let raw = (answers[id] ?? '').trim();

  if (raw === '') {
    // Fall back to an implied answer, if this field has one.
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

// ─── Building blocks ──────────────────────────────────────────────────

function heading(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 }
  });
}

function cell(text: string, bold = false): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
    margins: { top: 60, bottom: 60, left: 120, right: 120 }
  });
}

/** Multi-line narrative in a single cell. */
function narrativeCell(text: string): TableCell {
  const lines = text.trim() === '' ? [BLANK] : text.trim().split('\n');
  return new TableCell({
    children: lines.map((line) => new Paragraph({ children: [new TextRun(line)] })),
    margins: { top: 60, bottom: 60, left: 120, right: 120 }
  });
}

function table(rows: TableRow[]): Table {
  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE }
  });
}

function labelledRow(label: string, text: string): TableRow {
  return new TableRow({ children: [cell(label, true), cell(text)] });
}

function note(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, italics: true, size: 18 })],
    spacing: { before: 80, after: 160 }
  });
}

// ─── Sections ─────────────────────────────────────────────────────────

function overviewSection(state: AssessmentState, type: InstallationType): Array<Paragraph | Table> {
  const c = state.client;
  const v = (id: string) => value(c, id, type);

  const rows: TableRow[] = [
    labelledRow('Client', v('client')),
    labelledRow('Date of Conversation', v('conversationDate')),
    labelledRow('Sign-off Name', v('signOffName')),
    labelledRow('Sign-off Email', v('signOffEmail')),
    labelledRow('Technical Contact Name', v('technicalContactName')),
    labelledRow('Technical Contact Email', v('technicalContactEmail'))
  ];

  // The document's four-column user-landscape block. Universe modifiers do
  // not exist on Crystal Server, so that column carries n/a rather than a
  // misleading blank.
  const isCrystal = type === 'crystal-server';
  rows.push(
    new TableRow({
      children: [
        cell('User Landscape', true),
        cell('Consumers', true),
        cell('Universe Modifiers', true),
        cell('Report Modifiers', true)
      ]
    }),
    new TableRow({
      children: [
        cell(BLANK),
        cell(v('consumers')),
        cell(isCrystal ? 'n/a' : v('universeModifiers')),
        cell(v('reportModifiers'))
      ]
    })
  );

  rows.push(
    new TableRow({
      children: [cell('Narrative', true), narrativeCell(c.futureDirection ?? '')]
    }),
    new TableRow({
      children: [
        cell('Any adjacent work that might impact project delivery?', true),
        narrativeCell(c.adjacentWork ?? '')
      ]
    })
  );

  return [heading('Overview'), table(rows)];
}

/** The document's Platform Overview table, one per production environment. */
function platformTable(
  environment: EnvironmentState,
  type: InstallationType
): Table {
  const a = environment.answers;
  const v = (id: string) => value(a, id, type);
  const serverName = (a.serverName ?? '').trim();

  return table([
    new TableRow({
      children: [
        cell(environment.label, true),
        cell(serverName === '' ? 'Current Server' : `Current Server ${serverName}`, true)
      ]
    }),
    labelledRow('Operating System', v('operatingSystem')),
    labelledRow('Platform Software', v('platformSoftware')),
    labelledRow('CMS/Audit Database Software', v('cmsDatabaseSoftware')),
    labelledRow('Authentication', v('authentication')),
    labelledRow('Separate Tomcat?', v('separateTomcat')),
    labelledRow('HTTPS?', v('httpsConfigured')),
    labelledRow(
      'Web Server?',
      (a.separateWebServer ?? '') === 'yes'
        ? (a.webServerName ?? '').trim() || 'Yes'
        : v('separateWebServer')
    ),
    labelledRow('Externally Facing?', v('externallyFacing')),
    labelledRow('Clustered Environment?', v('clustered')),
    labelledRow('Auditing Currently Enabled?', v('auditingEnabled'))
  ]);
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
  if (state.client.hasTestEnvironments === 'yes') counts.push(`${test || 'an unspecified number of'} test`);
  if (state.client.hasDevEnvironments === 'yes') counts.push(`${dev || 'an unspecified number of'} development`);

  out.push(
    note(
      `Installation type: ${type === 'crystal-server' ? 'SAP Crystal Server' : 'SAP BusinessObjects'}. ${counts.join(', ')}. Test and development environments are rebuilt as a copy of the new production and are not detailed individually.`
    )
  );

  for (const environment of state.environments) {
    out.push(platformTable(environment, type));
    out.push(new Paragraph({ text: BLANK }));
  }

  return out;
}

/** The document's Content Migration table, one per production environment. */
function contentTable(environment: EnvironmentState, type: InstallationType): Table {
  const a = environment.answers;
  const v = (id: string) => value(a, id, type);
  const isCrystal = type === 'crystal-server';

  const rows: TableRow[] = [
    new TableRow({ children: [cell(environment.label, true), cell(BLANK, true)] }),
    labelledRow('Input File Repository Folder size', v('inputFileRepositoryGb')),
    labelledRow('Output File Repository Folder size', v('outputFileRepositoryGb'))
  ];

  if (isCrystal) {
    rows.push(labelledRow('Number of UNVs', 'n/a'), labelledRow('Number of UNXs', 'n/a'));
  } else if ((a.universeCountMode ?? '') === 'combined') {
    rows.push(
      labelledRow('Number of universes (combined UNV and UNX)', v('combinedUniverseCount'))
    );
  } else {
    rows.push(
      labelledRow('Number of UNVs', v('unvCount')),
      labelledRow('Number of UNXs', v('unxCount'))
    );
  }

  rows.push(
    labelledRow('Number of Crystal documents', v('crystalDocuments')),
    labelledRow('Number of WebI documents', isCrystal ? 'n/a' : v('webiDocuments')),
    labelledRow('Number of Publication/Program documents', v('publications')),
    labelledRow('Total Pending Instances', v('pendingInstances')),
    labelledRow('Total Successful Instances', v('successfulInstances')),
    labelledRow('Changes to schedule destinations required?', v('destinationChangesRequired'))
  );

  if ((a.destinationChangesRequired ?? '') === 'yes') {
    rows.push(
      new TableRow({
        children: [
          cell('What needs to change?', true),
          narrativeCell(a.destinationChangesNarrative ?? '')
        ]
      })
    );
  }

  rows.push(labelledRow('All successful instances required?', v('successfulInstancesRequired')));

  if ((a.successfulInstancesRequired ?? '') === 'some') {
    rows.push(
      new TableRow({
        children: [
          cell('Which instances are required?', true),
          narrativeCell(a.successfulInstancesNarrative ?? '')
        ]
      })
    );
  }

  return table(rows);
}

function contentSection(
  state: AssessmentState,
  type: InstallationType
): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [heading('Content Migration')];
  for (const environment of state.environments) {
    out.push(contentTable(environment, type));
    out.push(new Paragraph({ text: BLANK }));
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
  // does not have read n/a rather than being dropped, so the document has the
  // same shape whichever installation type produced it.
  const rows = tab.fields.map((field) =>
    labelledRow(
      field.label,
      shown.has(field.id) ? value(state.client, field.id, type) : 'n/a'
    )
  );

  return [heading('Training Requirements'), table(rows)];
}

function goLiveSection(state: AssessmentState): Array<Paragraph | Table> {
  const selected = (state.client.goLiveTiming ?? '').trim();

  // The tool asks one question; the document has four Yes/No rows. The
  // selected timing is Yes, the rest No. Nothing is recorded that the
  // consultant did not choose.
  const rows = GO_LIVE_DOCUMENT_ROWS.map((option) =>
    labelledRow(option.label, selected === '' ? BLANK : selected === option.value ? 'Yes' : 'No')
  );

  if (selected === 'specific-weekday') {
    const weekday = TABS.find((t) => t.id === 'go-live')!.fields.find(
      (f) => f.id === 'goLiveWeekday'
    );
    const raw = (state.client.goLiveWeekday ?? '').trim();
    rows.push(
      labelledRow(
        'Which day?',
        weekday?.options?.find((o) => o.value === raw)?.label ?? raw
      )
    );
  }

  return [heading('Go Live Requirements'), table(rows)];
}

function pointsToRaiseSection(notes: Array<{ scope?: string; text: string }>): Paragraph[] {
  if (notes.length === 0) return [];
  return [
    heading('Points to Raise'),
    ...notes.map(
      (n) =>
        new Paragraph({
          children: [
            ...(n.scope ? [new TextRun({ text: `${n.scope}: `, bold: true })] : []),
            new TextRun(n.text)
          ],
          bullet: { level: 0 },
          spacing: { after: 80 }
        })
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
    creator: 'Codestone SMB Pre-Sales Portal',
    title: `SAP BI Platform Install Assessment — ${client}`,
    description: 'Pre-sales install assessment captured during the technical conversation.',
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: 'SAP BI Platform — Pre-Sales Install Assessment', bold: true, size: 32 })
            ],
            spacing: { after: 80 }
          }),
          new Paragraph({
            children: [new TextRun({ text: client, size: 24 })],
            spacing: { after: 240 },
            alignment: AlignmentType.LEFT
          }),
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

/** Unused tab check — keeps `isTabVisible` honest if a tab is ever added. */
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
