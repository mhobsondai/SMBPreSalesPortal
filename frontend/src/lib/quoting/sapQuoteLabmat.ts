/**
 * LabMat (.xlsx) writer.
 *
 * Fills `templates/blank-bia-labmat.xlsx` — the house-style workbook — rather
 * than building a sheet from scratch. The template carries no formulas, no
 * conditional formatting and no data validation: 316 merged cells, forty cell
 * styles and forty-five pre-styled rows. Writing values into it therefore
 * preserves the look exactly, which is why this is a fill and not a build.
 *
 * Returns bytes and touches no DOM. The page wraps the result in a `Blob`;
 * the tests unzip it and assert against the real cell values.
 *
 * `exceljs` is ~950 kB, so it is imported inside the function and lands in
 * its own chunk. Same reasoning as `docx` in the install assessment (AD-12).
 */

import {
  HOURS_PER_DAY,
  PM_CONTINGENCY_CODE,
  PM_CONTINGENCY_DESCRIPTION
} from '../../config/sapQuoteGeneratorModel';
import { costedPhases, type QuoteState, type QuoteTotals } from './sapQuoteGenerator';

/**
 * Sheet name and cell addresses, transcribed from the template.
 *
 * The header block is column D. Body rows start at row 9 and use a sparse
 * set of columns because the template merges across the gaps — writing to
 * `B` or `C` would put a value inside a merge and be dropped.
 */
export const LABMAT_LAYOUT = {
  sheet: 'LabMat',
  header: {
    solutionArchitect: 'D2',
    date: 'D3',
    client: 'D4',
    ticket: 'D5',
    totalServicePrice: 'D6'
  },
  firstBodyRow: 9,
  /** Rows cleared before writing, so a shorter quote leaves nothing behind. */
  lastClearedRow: 80,
  columns: {
    stack: 1, // A — product stack, or the phase name on a phase row
    code: 4, // D
    description: 9, // I
    activity: 14, // N
    hours: 21, // U
    days: 23, // W
    dayRate: 25, // Y
    value: 27 // AA
  }
} as const;

const BODY_COLUMNS = [
  LABMAT_LAYOUT.columns.stack,
  LABMAT_LAYOUT.columns.code,
  LABMAT_LAYOUT.columns.description,
  LABMAT_LAYOUT.columns.activity,
  LABMAT_LAYOUT.columns.hours,
  LABMAT_LAYOUT.columns.days,
  LABMAT_LAYOUT.columns.dayRate,
  LABMAT_LAYOUT.columns.value
];

/** Columns that carry a value on a phase-total row, and are bolded. */
const PHASE_COLUMNS = [
  LABMAT_LAYOUT.columns.stack,
  LABMAT_LAYOUT.columns.hours,
  LABMAT_LAYOUT.columns.days,
  LABMAT_LAYOUT.columns.dayRate,
  LABMAT_LAYOUT.columns.value
];

export interface LabmatRow {
  row: number;
  stack: string;
  code: string;
  description: string;
  activity: string;
  hours: number;
  days: number;
  dayRate: number;
  value: number;
  isPhaseTotal: boolean;
}

/**
 * The rows the writer will produce, as data.
 *
 * Separated from the workbook so the row plan can be asserted without
 * loading `exceljs` — the arithmetic is what matters and the spreadsheet is
 * just where it lands.
 */
export function planLabmatRows(state: QuoteState, totals: QuoteTotals): LabmatRow[] {
  const rows: LabmatRow[] = [];
  let row = LABMAT_LAYOUT.firstBodyRow;

  const push = (r: Omit<LabmatRow, 'row'>) => {
    rows.push({ ...r, row });
    row += 1;
  };

  for (const phase of costedPhases(totals.phases)) {
    push({
      stack: phase.name,
      code: '',
      description: '',
      activity: '',
      hours: phase.hours,
      days: phase.days,
      dayRate: phase.dayRate,
      value: phase.value,
      isPhaseTotal: true
    });
    for (const line of phase.lines) {
      push({
        stack: state.productStack,
        code: line.code,
        description: line.description,
        activity: line.activity,
        hours: line.hours,
        days: line.days,
        dayRate: line.dayRate,
        value: line.value,
        isPhaseTotal: false
      });
    }
  }

  if (totals.pmHours > 0) {
    const phaseHours = totals.pmHours + totals.pmContingencyHours;
    push({
      stack: 'Data-Insights-BIA-Project-Management',
      code: '',
      description: '',
      activity: '',
      hours: phaseHours,
      days: phaseHours / HOURS_PER_DAY,
      dayRate: totals.dayRate,
      value: totals.pmValue + totals.pmContingencyValue,
      isPhaseTotal: true
    });
    push({
      stack: 'Project Management',
      code: totals.pmProductCode,
      description: totals.pmLabel,
      activity: '',
      hours: totals.pmHours,
      days: totals.pmDays,
      dayRate: totals.dayRate,
      value: totals.pmValue,
      isPhaseTotal: false
    });
  }

  if (totals.pmContingencyHours > 0) {
    push({
      stack: 'Project Management',
      code: PM_CONTINGENCY_CODE,
      description: PM_CONTINGENCY_DESCRIPTION,
      activity: '',
      hours: totals.pmContingencyHours,
      days: totals.pmContingencyDays,
      dayRate: totals.dayRate,
      value: totals.pmContingencyValue,
      isPhaseTotal: false
    });
  }

  return rows;
}

/**
 * Fill the template and return the workbook bytes.
 *
 * `template` is the blank LabMat, either the bundled asset or a file the
 * consultant supplied to override it.
 */
export async function buildLabmat(
  template: ArrayBuffer,
  state: QuoteState,
  totals: QuoteTotals
): Promise<ArrayBuffer> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template);

  const sheet = workbook.getWorksheet(LABMAT_LAYOUT.sheet);
  if (!sheet) {
    throw new Error(
      `The selected workbook has no "${LABMAT_LAYOUT.sheet}" sheet — is it the blank LabMat template?`
    );
  }

  const { header } = LABMAT_LAYOUT;
  sheet.getCell(header.solutionArchitect).value = state.solutionArchitect || '';
  sheet.getCell(header.date).value = state.projectDate || '';
  sheet.getCell(header.client).value = state.client || '';
  sheet.getCell(header.ticket).value = state.ticket || '';
  sheet.getCell(header.totalServicePrice).value = totals.grandValue;

  // Clear the body before writing, so re-using a template that already has
  // rows in it — or producing a shorter quote than the last one — cannot
  // leave a stale line behind that still footed into a printed total.
  for (let r = LABMAT_LAYOUT.firstBodyRow; r <= LABMAT_LAYOUT.lastClearedRow; r += 1) {
    for (const column of BODY_COLUMNS) {
      sheet.getCell(r, column).value = null;
    }
  }

  const { columns } = LABMAT_LAYOUT;
  for (const plan of planLabmatRows(state, totals)) {
    sheet.getCell(plan.row, columns.stack).value = plan.stack;
    sheet.getCell(plan.row, columns.hours).value = plan.hours;
    sheet.getCell(plan.row, columns.days).value = plan.days;
    sheet.getCell(plan.row, columns.dayRate).value = plan.dayRate;
    sheet.getCell(plan.row, columns.value).value = plan.value;

    if (plan.isPhaseTotal) {
      for (const column of PHASE_COLUMNS) {
        const cell = sheet.getCell(plan.row, column);
        cell.font = { ...cell.font, bold: true };
      }
      continue;
    }

    sheet.getCell(plan.row, columns.code).value = plan.code;
    sheet.getCell(plan.row, columns.description).value = plan.description;
    sheet.getCell(plan.row, columns.activity).value = plan.activity;
  }

  const out = await workbook.xlsx.writeBuffer();
  return out as ArrayBuffer;
}
