/**
 * SAP Pre-Sales Install Assessment — state, visibility and export.
 *
 * Pure functions, no DOM, no network, no React. The page is a rendering
 * of what this module computes.
 *
 * Two things here are contracts rather than implementation details, and
 * both are pinned in `__fixtures__/reference.json`:
 *
 * 1. **Field visibility.** Choosing Crystal Server removes one tab and
 *    several fields. A field that silently stops being asked becomes a
 *    quote that silently stops pricing it.
 * 2. **Export shape.** `toExport()` is what the SAP Quote Generator will
 *    read. Renaming a key is a breaking change — bump
 *    `ASSESSMENT_SCHEMA_VERSION`.
 *
 * Nothing here derives an effort or a price. Every figure in the output is
 * a figure the client stated.
 */

import {
  ASSESSMENT_SCHEMA_VERSION,
  MAX_PRODUCTION_ENVIRONMENTS,
  OUT_OF_HOURS_TIMINGS,
  TABS,
  type Field,
  type InstallationType,
  type Tab
} from '../../config/sapInstallAssessmentModel';

// ─── State ────────────────────────────────────────────────────────────

/**
 * All answers are held as strings — that is what form controls produce,
 * and it keeps "unanswered" (`''`) distinct from "answered zero" (`'0'`).
 * Coercion to numbers happens once, at export.
 */
export type Answers = Record<string, string>;

export interface EnvironmentState {
  /** Stable across renames and reorders. */
  id: string;
  /** Consultant-facing label, e.g. `PROD01`. Defaults to `Production N`. */
  label: string;
  answers: Answers;
}

export interface AssessmentState {
  client: Answers;
  environments: EnvironmentState[];
}

export const CLIENT_TABS = TABS.filter((t) => t.scope === 'client');
export const ENVIRONMENT_TABS = TABS.filter((t) => t.scope === 'environment');

export function defaultEnvironmentLabel(index: number): string {
  return `Production ${index + 1}`;
}

/**
 * A blank assessment.
 *
 * `today` is injected rather than read from the clock so the export is
 * testable and the fixture stays stable.
 */
export function createBlankAssessment(today: string): AssessmentState {
  return {
    client: {
      conversationDate: today,
      installationType: 'businessobjects',
      productionEnvironmentCount: '1'
    },
    environments: [
      { id: 'env-1', label: defaultEnvironmentLabel(0), answers: {} }
    ]
  };
}

export function installationTypeOf(state: AssessmentState): InstallationType {
  return state.client.installationType === 'crystal-server'
    ? 'crystal-server'
    : 'businessobjects';
}

/**
 * Reconcile the environment list with the count on the Landscape tab.
 *
 * **Grows by appending and shrinks by dropping from the end.** Reducing the
 * count discards the answers for the removed environments, so the page
 * confirms before calling this with a smaller number — losing a completed
 * environment to a mistyped digit would be unrecoverable.
 */
export function syncEnvironments(
  state: AssessmentState,
  count: number
): AssessmentState {
  const target = Math.min(
    Math.max(Number.isFinite(count) ? Math.floor(count) : 1, 1),
    MAX_PRODUCTION_ENVIRONMENTS
  );

  if (target === state.environments.length) return state;

  if (target < state.environments.length) {
    return { ...state, environments: state.environments.slice(0, target) };
  }

  const added: EnvironmentState[] = [];
  for (let i = state.environments.length; i < target; i += 1) {
    added.push({
      id: `env-${i + 1}`,
      label: defaultEnvironmentLabel(i),
      answers: {}
    });
  }
  return { ...state, environments: [...state.environments, ...added] };
}

// ─── Visibility ───────────────────────────────────────────────────────

/** Does this tab apply to the chosen installation type? */
export function isTabVisible(tab: Tab, type: InstallationType): boolean {
  return !tab.onlyFor || tab.onlyFor.includes(type);
}

/**
 * Fields on a tab that should currently be rendered.
 *
 * Two independent gates: installation type (`onlyFor`) and a dependency on
 * another answer in the same scope (`showWhen`). A field hidden by either
 * is also excluded from completeness — an unanswerable question must not
 * hold a tab at incomplete for ever.
 */
export function visibleFields(
  tab: Tab,
  type: InstallationType,
  answers: Answers
): Field[] {
  return tab.fields.filter((field) => {
    if (field.onlyFor && !field.onlyFor.includes(type)) return false;
    if (field.showWhen) {
      const value = answers[field.showWhen.field] ?? '';
      if (!field.showWhen.equals.includes(value)) return false;
    }
    return true;
  });
}

export function visibleTabs(type: InstallationType): Tab[] {
  return TABS.filter((tab) => isTabVisible(tab, type));
}

/**
 * Fields hidden by a dependency whose answer is nonetheless *determined* by
 * that dependency, paired with the value they take.
 *
 * "Separate web server?" is not asked when there is no separate Tomcat,
 * because there cannot be one — so the answer is No, not unknown. Exporting
 * it as No means the Quote Generator reads a fact rather than re-deriving a
 * rule that lives here.
 *
 * A field hidden for any other reason — installation type, or a dependency
 * that makes it genuinely irrelevant — is not included.
 */
export function impliedValues(
  tab: Tab,
  type: InstallationType,
  answers: Answers
): Record<string, string> {
  const shown = new Set(visibleFields(tab, type, answers).map((f) => f.id));
  const out: Record<string, string> = {};
  for (const field of tab.fields) {
    if (shown.has(field.id)) continue;
    if (field.impliedWhenHidden === undefined) continue;
    if (field.onlyFor && !field.onlyFor.includes(type)) continue;
    out[field.id] = field.impliedWhenHidden;
  }
  return out;
}

// ─── Completeness ─────────────────────────────────────────────────────

export interface Completeness {
  /** Visible, non-optional fields on this tab. */
  required: number;
  answered: number;
  isComplete: boolean;
}

export function tabCompleteness(
  tab: Tab,
  type: InstallationType,
  answers: Answers
): Completeness {
  const required = visibleFields(tab, type, answers).filter((f) => !f.optional);
  const answered = required.filter((f) => (answers[f.id] ?? '').trim() !== '');
  return {
    required: required.length,
    answered: answered.length,
    isComplete: required.length > 0 && answered.length === required.length
  };
}

/** Completeness across the whole assessment, client tabs and every environment. */
export function overallCompleteness(state: AssessmentState): Completeness {
  const type = installationTypeOf(state);
  let required = 0;
  let answered = 0;

  for (const tab of CLIENT_TABS) {
    if (!isTabVisible(tab, type)) continue;
    const c = tabCompleteness(tab, type, state.client);
    required += c.required;
    answered += c.answered;
  }
  for (const environment of state.environments) {
    for (const tab of ENVIRONMENT_TABS) {
      if (!isTabVisible(tab, type)) continue;
      const c = tabCompleteness(tab, type, environment.answers);
      required += c.required;
      answered += c.answered;
    }
  }

  return {
    required,
    answered,
    isComplete: required > 0 && answered === required
  };
}

// ─── Advisories ───────────────────────────────────────────────────────

/**
 * Things the consultant should say out loud on the call, triggered by what
 * has been answered.
 *
 * These are prompts, not calculations — no number here feeds a price. They
 * exist because each one is a conversation that is cheap now and expensive
 * after the quote has gone out.
 */
export interface Advisory {
  id: string;
  /** Environment label, or undefined for a client-level advisory. */
  scope?: string;
  text: string;
}

export function advisories(state: AssessmentState): Advisory[] {
  const out: Advisory[] = [];
  const type = installationTypeOf(state);

  for (const environment of state.environments) {
    const a = environment.answers;

    if (a.auditingEnabled === 'no') {
      out.push({
        id: `${environment.id}-auditing`,
        scope: environment.label,
        text: 'Auditing is not currently enabled. It is enabled by default on the new server, so tell the client to expect audit data they do not have today.'
      });
    }

    if (a.successfulInstancesRequired === 'no' || a.successfulInstancesRequired === 'some') {
      out.push({
        id: `${environment.id}-instances`,
        scope: environment.label,
        text: 'Not all successful instances are required. Recommend the client raises a support ticket for instructions on cleaning them up before migration — it reduces the volume to move.'
      });
    }

    if (a.separateWebServer === 'yes' && !(a.webServerName ?? '').trim()) {
      out.push({
        id: `${environment.id}-webserver`,
        scope: environment.label,
        text: 'A separate web server was confirmed but not named. Get the name — it affects the install plan.'
      });
    }
  }

  if (OUT_OF_HOURS_TIMINGS.includes(state.client.goLiveTiming ?? '')) {
    out.push({
      id: 'go-live-rate',
      text: 'Go-live is outside core hours. That attracts a different rate — make sure the quote reflects it.'
    });
  }

  if (type === 'crystal-server') {
    out.push({
      id: 'crystal-scope',
      text: 'Crystal Server: universe and Web Intelligence questions were not asked, because the platform does not have them. If the client mentions either, the installation type is probably wrong.'
    });
  }

  return out;
}

// ─── Export ───────────────────────────────────────────────────────────

/** `''` → undefined, so an unanswered number is absent rather than 0. */
function num(raw: string | undefined): number | undefined {
  const value = Number.parseFloat((raw ?? '').trim());
  return Number.isFinite(value) ? value : undefined;
}

const NUMERIC_KINDS = new Set(['number', 'gb']);

function exportAnswers(
  tabs: readonly Tab[],
  type: InstallationType,
  answers: Answers
): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const tab of tabs) {
    if (!isTabVisible(tab, type)) continue;

    for (const field of visibleFields(tab, type, answers)) {
      const raw = (answers[field.id] ?? '').trim();
      if (raw === '') {
        out[field.id] = null;
        continue;
      }
      out[field.id] = NUMERIC_KINDS.has(field.kind) ? (num(raw) ?? null) : raw;
    }

    // Determined by another answer rather than asked — see impliedValues().
    for (const [id, value] of Object.entries(impliedValues(tab, type, answers))) {
      out[id] = value;
    }
  }
  return out;
}

export interface AssessmentExport {
  schemaVersion: number;
  tool: 'sap-install-assessment';
  installationType: InstallationType;
  /** Keys omitted here were not applicable, not merely unanswered. */
  client: Record<string, string | number | null>;
  environments: Array<{
    id: string;
    label: string;
    answers: Record<string, string | number | null>;
  }>;
  completeness: Completeness;
  advisories: Advisory[];
}

/**
 * The machine-readable assessment. This is the contract with the SAP Quote
 * Generator: additive changes are safe, renames are not.
 *
 * Three states, deliberately distinct:
 *
 * | In the export | Means |
 * |---|---|
 * | absent | Not applicable — the platform does not have this |
 * | `null` | Applicable, not yet answered |
 * | a value | Answered, or **implied** by another answer |
 *
 * Collapsing the first two would eventually price zero universes for an
 * estate that has eighty.
 */
export function toExport(state: AssessmentState): AssessmentExport {
  const type = installationTypeOf(state);
  return {
    schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    tool: 'sap-install-assessment',
    installationType: type,
    client: exportAnswers(CLIENT_TABS, type, state.client),
    environments: state.environments.map((environment) => ({
      id: environment.id,
      label: environment.label,
      answers: exportAnswers(ENVIRONMENT_TABS, type, environment.answers)
    })),
    completeness: overallCompleteness(state),
    advisories: advisories(state)
  };
}

// ─── Plain-text summary ───────────────────────────────────────────────

function displayValue(field: Field, raw: string): string {
  const value = raw.trim();
  if (value === '') return '—';
  if (field.kind === 'yesno') return value === 'yes' ? 'Yes' : 'No';
  if (field.kind === 'gb') return `${value} GB`;
  if (field.options) {
    return field.options.find((o) => o.value === value)?.label ?? value;
  }
  return value;
}

function summariseTab(
  tab: Tab,
  type: InstallationType,
  answers: Answers,
  lines: string[]
): void {
  const fields = visibleFields(tab, type, answers);
  if (fields.length === 0) return;

  lines.push('');
  lines.push(tab.title.toUpperCase());
  for (const field of fields) {
    const raw = answers[field.id] ?? '';
    if (field.kind === 'textarea') {
      lines.push(`  ${field.label}:`);
      lines.push(`    ${raw.trim() === '' ? '—' : raw.trim().replace(/\n/g, '\n    ')}`);
    } else {
      lines.push(`  ${field.label}: ${displayValue(field, raw)}`);
    }
  }

  // Implied answers appear in the record, marked, so the reader can see the
  // value without wondering why the question is missing.
  const implied = impliedValues(tab, type, answers);
  for (const [id, value] of Object.entries(implied)) {
    const field = tab.fields.find((f) => f.id === id);
    if (!field) continue;
    lines.push(`  ${field.label}: ${displayValue(field, value)} (implied)`);
  }
}

/**
 * Copy-ready assessment record.
 *
 * Same role as `summaryLines` in the Fabric estimator: plain text that can
 * be pasted straight into a document, rather than a rendered table.
 */
export function summaryLines(state: AssessmentState): string[] {
  const type = installationTypeOf(state);
  const lines: string[] = [];

  const client = (state.client.client ?? '').trim() || 'Unnamed client';
  lines.push('SAP BI PLATFORM — PRE-SALES INSTALL ASSESSMENT');
  lines.push(client);

  for (const tab of CLIENT_TABS.filter((t) => t.id !== 'training' && t.id !== 'go-live')) {
    if (isTabVisible(tab, type)) summariseTab(tab, type, state.client, lines);
  }

  for (const environment of state.environments) {
    lines.push('');
    lines.push(`── ${environment.label} ${'─'.repeat(Math.max(2, 40 - environment.label.length))}`);
    for (const tab of ENVIRONMENT_TABS) {
      if (isTabVisible(tab, type)) summariseTab(tab, type, environment.answers, lines);
    }
  }

  lines.push('');
  lines.push('─'.repeat(44));
  for (const tab of CLIENT_TABS.filter((t) => t.id === 'training' || t.id === 'go-live')) {
    if (isTabVisible(tab, type)) summariseTab(tab, type, state.client, lines);
  }

  const notes = advisories(state);
  if (notes.length > 0) {
    lines.push('');
    lines.push('POINTS TO RAISE');
    for (const note of notes) {
      lines.push(`  • ${note.scope ? `[${note.scope}] ` : ''}${note.text}`);
    }
  }

  const completeness = overallCompleteness(state);
  lines.push('');
  lines.push(
    `Completeness: ${completeness.answered} of ${completeness.required} applicable fields answered.`
  );

  return lines;
}

// ─── Persistence ──────────────────────────────────────────────────────

/**
 * localStorage key. Versioned, so a schema change does not have to migrate
 * a half-finished assessment — it starts clean instead.
 */
export const STORAGE_KEY = `codestone.sap-install-assessment.v${ASSESSMENT_SCHEMA_VERSION}`;

/**
 * Restore a saved assessment.
 *
 * Returns `undefined` for anything it does not recognise rather than
 * attempting a repair. A partially-understood assessment is worse than an
 * empty one: the consultant would not know which answers survived.
 */
export function deserialise(raw: string | null): AssessmentState | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return undefined;
    const candidate = parsed as Partial<AssessmentState>;
    if (!candidate.client || typeof candidate.client !== 'object') return undefined;
    if (!Array.isArray(candidate.environments) || candidate.environments.length === 0) {
      return undefined;
    }
    for (const environment of candidate.environments) {
      if (
        !environment ||
        typeof environment.id !== 'string' ||
        typeof environment.label !== 'string' ||
        typeof environment.answers !== 'object'
      ) {
        return undefined;
      }
    }
    return candidate as AssessmentState;
  } catch {
    return undefined;
  }
}

export function serialise(state: AssessmentState): string {
  return JSON.stringify(state);
}

/** `Install-Assessment-Acme-Ltd-2026-08-03.json` */
export function exportFilename(state: AssessmentState, extension: string): string {
  const client = (state.client.client ?? '').trim() || 'client';
  const slug =
    client
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'client';
  const date = (state.client.conversationDate ?? '').trim() || 'undated';
  return `Install-Assessment-${slug}-${date}.${extension}`;
}
