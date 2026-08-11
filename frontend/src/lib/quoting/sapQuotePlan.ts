/**
 * The plan API: what we send, what we accept back, and how a plan becomes
 * the seed the existing preview already knows how to diff.
 *
 * Three responsibilities, in the order they happen:
 *
 * 1. `payloadForPlan()` — build the request from an allowlist. Nothing
 *    personal travels, because nothing personal is named.
 * 2. `validatePlanResponse()` — **reject, never repair.** A response that
 *    breaks the contract is a bug in the skill, and repairing it here would
 *    hide that bug behind a plausible quote.
 * 3. `planToSeed()` — map a validated plan onto `QuoteSeed`, so
 *    `planImport()` and `applyImport()` work unchanged. They diff a seed
 *    against the current quote and apply an accepted subset; neither cares
 *    where the seed came from, which is exactly why this feature does not
 *    touch them.
 *
 * No DOM, no network. The fetch lives in `lib/api.ts`. See AD-17.
 */

import {
  PLAN_PAYLOAD_ANSWER_FIELDS,
  PLAN_PAYLOAD_CLIENT_FIELDS,
  PLAN_SCHEMA_VERSION,
  PLAN_TOOL,
  type PlanLine,
  type PlanScope,
  type PlanWarning,
  type QuotePlan
} from '../../config/sapQuotePlanModel';
import {
  PRODUCT_STACKS,
  SCOPE_CATEGORIES,
  isContingencyCode,
  type ProjectType,
  type ScopeCategoryId
} from '../../config/sapQuoteGeneratorModel';
import { MIGRATION_BANDS, type AuthMode } from '../../config/sapQuoteImportModel';
import type {
  AssessmentExport,
  Aggregate,
  QuoteSeed,
  SeedNote
} from './sapQuoteImport';

const SCOPE_CATEGORY_IDS: ScopeCategoryId[] = ['platform', 'training', 'other'];

/** Every code the catalogue knows, from the primary stacks only. */
const CATALOGUE_CODES: ReadonlySet<string> = new Set(
  PRODUCT_STACKS.flatMap((stack) =>
    stack.phases.flatMap((phase) => phase.products.map((product) => product.id))
  )
);

const SCOPE_IDS: Record<ScopeCategoryId, ReadonlySet<string>> = {
  platform: new Set(
    SCOPE_CATEGORIES.find((c) => c.id === 'platform')!.items.map((i) => i.id)
  ),
  training: new Set(
    SCOPE_CATEGORIES.find((c) => c.id === 'training')!.items.map((i) => i.id)
  ),
  other: new Set(
    SCOPE_CATEGORIES.find((c) => c.id === 'other')!.items.map((i) => i.id)
  )
};

/**
 * Keys that must not appear anywhere in a plan.
 *
 * The app derives contingency per phase, tiers PM itself and computes every
 * total (AD-14). A plan carrying any of it is the skill exceeding its remit,
 * and the failure has to be loud — a quote silently built on someone else's
 * PM tiering is the £140.40 problem all over again.
 */
const FORBIDDEN_KEYS = [
  'contingency',
  'pm',
  'pmtier',
  'pm_tier',
  'total',
  'totals',
  'totalvalue',
  'total_value',
  'grandtotal',
  'grandvalue',
  'rate',
  'dayrate',
  'value',
  'cost',
  'price'
];

/** A response we refuse. The message is shown to the consultant verbatim. */
export class PlanRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanRejected';
  }
}

// ─── 1. What we send ──────────────────────────────────────────────────

/**
 * Build the request payload from the allowlist in `sapQuotePlanModel.ts`.
 *
 * Built, not cleaned. A field absent from the allowlist cannot reach the
 * request no matter what it holds, which is the only version of this
 * guarantee that survives someone adding a free-text box to the assessment
 * later. See AD-17.
 */
export function payloadForPlan(assessment: AssessmentExport): unknown {
  const client: Record<string, unknown> = {};
  for (const field of PLAN_PAYLOAD_CLIENT_FIELDS) {
    if (field in assessment.client) client[field] = assessment.client[field];
  }

  return {
    schemaVersion: assessment.schemaVersion,
    tool: assessment.tool,
    installationType: assessment.installationType,
    client,
    environments: assessment.environments.map((environment) => {
      const answers: Record<string, unknown> = {};
      for (const field of PLAN_PAYLOAD_ANSWER_FIELDS) {
        if (field in environment.answers) answers[field] = environment.answers[field];
      }
      return { id: environment.id, label: environment.label, answers };
    }),
    completeness: assessment.completeness,
    advisories: assessment.advisories
  };
}

// ─── 2. What we accept back ───────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((v) => typeof v === 'string' && v.trim() !== '')
  );
}

/** Walk every key in the document, so a total cannot hide in a nested object. */
function forbiddenKeyIn(node: unknown, path = 'the response'): string | undefined {
  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      const found = forbiddenKeyIn(node[index], `${path}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(node)) return undefined;
  for (const [key, value] of Object.entries(node)) {
    if (FORBIDDEN_KEYS.includes(key.toLowerCase())) return `${path}.${key}`;
    const found = forbiddenKeyIn(value, `${path}.${key}`);
    if (found) return found;
  }
  return undefined;
}

function readScope(raw: unknown, field: string, strict: boolean): PlanScope {
  if (!isRecord(raw)) {
    throw new PlanRejected(`${field} must be an object with platform, training and other.`);
  }
  const scope = { platform: [], training: [], other: [] } as PlanScope;
  for (const category of SCOPE_CATEGORY_IDS) {
    const values = raw[category];
    if (!isStringList(values)) {
      throw new PlanRejected(`${field}.${category} must be an array of strings.`);
    }
    if (strict) {
      for (const id of values) {
        if (!SCOPE_IDS[category].has(id)) {
          throw new PlanRejected(
            `${field}.${category} names a scope item this quote does not have: "${id}".`
          );
        }
      }
    }
    scope[category] = [...values];
  }
  return scope;
}

function readLine(raw: unknown, index: number): PlanLine {
  const where = `Line ${index + 1}`;
  if (!isRecord(raw)) throw new PlanRejected(`${where} is not an object.`);

  const code = raw.code;
  if (typeof code !== 'string' || code === '') {
    throw new PlanRejected(`${where} has no product code.`);
  }
  if (isContingencyCode(code)) {
    throw new PlanRejected(
      `${where} is a contingency line (${code}). The quote derives contingency itself.`
    );
  }
  if (code.startsWith('DI-BIA-PM-')) {
    throw new PlanRejected(
      `${where} is a project management line (${code}). The quote tiers PM itself.`
    );
  }
  if (!CATALOGUE_CODES.has(code)) {
    throw new PlanRejected(`${where} uses a product code that is not in the catalogue: ${code}.`);
  }

  const hours = raw.hours;
  if (typeof hours !== 'number' || !Number.isFinite(hours)) {
    throw new PlanRejected(`${where} (${code}) has no usable hours.`);
  }
  if (hours <= 0) {
    throw new PlanRejected(`${where} (${code}) has hours of ${hours}. A line must be worth something.`);
  }

  const activity = raw.activity;
  if (typeof activity !== 'string' || activity.trim() === '') {
    throw new PlanRejected(`${where} (${code}) has no activity description.`);
  }

  const derivation = raw.derivation;
  if (typeof derivation !== 'string' || derivation.trim() === '') {
    throw new PlanRejected(
      `${where} (${code}) has no derivation. An hour nobody can explain is an hour nobody can defend.`
    );
  }

  const source = raw.source;
  if (source !== 'engine' && source !== 'model') {
    throw new PlanRejected(`${where} (${code}) does not say whether it came from the engine or the model.`);
  }

  const line: PlanLine = { code, hours, activity, derivation, source };

  if (source === 'model') {
    if (!('engineHours' in raw)) {
      throw new PlanRejected(
        `${where} (${code}) was adjusted by the model but does not say what the engine proposed.`
      );
    }
    const engineHours = raw.engineHours;
    if (engineHours !== null && typeof engineHours !== 'number') {
      throw new PlanRejected(`${where} (${code}) has an unusable engineHours.`);
    }
    line.engineHours = engineHours as number | null;
  }

  return line;
}

function readWarning(raw: unknown, index: number): PlanWarning {
  if (!isRecord(raw)) throw new PlanRejected(`Warning ${index + 1} is not an object.`);
  const { id, severity, text } = raw;
  if (typeof id !== 'string' || id === '') {
    throw new PlanRejected(`Warning ${index + 1} has no id.`);
  }
  if (severity !== 'info' && severity !== 'warn' && severity !== 'error') {
    throw new PlanRejected(`Warning "${id}" has an unrecognised severity.`);
  }
  if (typeof text !== 'string' || text.trim() === '') {
    throw new PlanRejected(`Warning "${id}" has no text.`);
  }
  return { id, severity, text };
}

/**
 * Validate a plan, or refuse it.
 *
 * Deliberately unhelpful about near-misses, for the reason
 * `parseAssessmentExport()` gives: a half-understood plan produces a quote
 * nobody can audit. Every message names what is wrong and why the app cares,
 * because the consultant sees it and the skill author has to act on it.
 */
export function validatePlanResponse(raw: unknown): QuotePlan {
  if (!isRecord(raw)) throw new PlanRejected('The response was not an object.');

  if (raw.tool !== PLAN_TOOL) {
    throw new PlanRejected(
      `The response is not a quote plan — it says tool "${String(raw.tool)}".`
    );
  }
  if (raw.schemaVersion !== PLAN_SCHEMA_VERSION) {
    throw new PlanRejected(
      `The response is schema v${String(raw.schemaVersion)} — this quote reads ` +
        `v${PLAN_SCHEMA_VERSION}.`
    );
  }

  const forbidden = forbiddenKeyIn(raw);
  if (forbidden) {
    throw new PlanRejected(
      `The response carries "${forbidden}". Contingency, project management and ` +
        'every total belong to the quote, not the plan.'
    );
  }

  const route = raw.route;
  if (route !== 'install' && route !== 'upgrade') {
    throw new PlanRejected(`The response has no route, or an unrecognised one.`);
  }
  const routeReason = raw.routeReason;
  if (typeof routeReason !== 'string' || routeReason.trim() === '') {
    throw new PlanRejected('The response does not say why it chose that route.');
  }

  const productStack = raw.productStack;
  if (
    typeof productStack !== 'string' ||
    !PRODUCT_STACKS.some((stack) => stack.name === productStack)
  ) {
    throw new PlanRejected(
      `The response names a product stack this quote does not have: "${String(productStack)}".`
    );
  }

  if (!Array.isArray(raw.lines) || raw.lines.length === 0) {
    throw new PlanRejected('The response proposes no effort lines.');
  }
  const lines = raw.lines.map(readLine);

  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.code)) {
      throw new PlanRejected(`The response proposes ${line.code} twice.`);
    }
    seen.add(line.code);
  }

  /*
   * A quote is EITHER an in-place upgrade OR an install and migration.
   *
   * `routeConflict()` in sapQuoteGenerator.ts applies the same rule, but it
   * takes assembled phases rather than a flat line list, so the check is
   * restated here against codes rather than contorting a plan into a shape
   * it never has. If one changes, change both.
   */
  const hasUpgrade = lines.some((line) => line.code.includes('-BLD-UPGR-'));
  const hasMigration = lines.some(
    (line) => line.code.includes('-BLD-MIGR-') || line.code.endsWith('-BLD-MIGRATION')
  );
  if (hasUpgrade && hasMigration) {
    throw new PlanRejected(
      'The response mixes in-place upgrade and install lines. A quote is one route or the other.'
    );
  }
  if (route === 'upgrade' && hasMigration) {
    throw new PlanRejected('The response says upgrade but proposes install and migration lines.');
  }
  if (route === 'install' && hasUpgrade) {
    throw new PlanRejected('The response says install but proposes in-place upgrade lines.');
  }

  const expectedInfix = productStack === 'SAP Crystal Server' ? '-CRY-' : '-BOBJ-';
  for (const line of lines) {
    if (line.code.startsWith('DI-BIA-SAP-') && !line.code.includes(expectedInfix)) {
      throw new PlanRejected(
        `${line.code} does not belong to ${productStack}.`
      );
    }
  }

  const scope = readScope(raw.scope, 'scope', true);
  const customScope = readScope(raw.customScope, 'customScope', false);

  for (const field of ['dependencies', 'assumptions', 'exclusions'] as const) {
    if (!isStringList(raw[field])) {
      throw new PlanRejected(`The response has no usable ${field}.`);
    }
  }

  const intro = raw.intro;
  if (typeof intro !== 'string' || intro.trim() === '') {
    throw new PlanRejected('The response carries no project brief.');
  }
  if (!intro.includes('{client}')) {
    /*
     * The brief must come back tokenised. A substituted name means a client
     * name reached the skill — which the payload allowlist makes impossible,
     * so this firing means the allowlist has been bypassed.
     */
    throw new PlanRejected(
      'The project brief has had a client name substituted into it. It must come back with {client} intact.'
    );
  }

  if (!isRecord(raw.env)) {
    throw new PlanRejected('The response carries no derived inputs to audit.');
  }

  const warnings = Array.isArray(raw.warnings) ? raw.warnings.map(readWarning) : [];
  if (!Array.isArray(raw.warnings)) {
    throw new PlanRejected('The response has no warnings list.');
  }

  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    tool: PLAN_TOOL,
    route,
    routeReason,
    productStack,
    lines,
    scope,
    customScope,
    dependencies: [...(raw.dependencies as string[])],
    assumptions: [...(raw.assumptions as string[])],
    exclusions: [...(raw.exclusions as string[])],
    intro,
    env: raw.env,
    warnings
  };
}

// ─── 3. Plan → seed ───────────────────────────────────────────────────

function aggregate(total: number | undefined): Aggregate {
  return { total: total ?? 0, unknown: [] };
}

const AUTH_MODES_BY_NAME: Record<string, AuthMode> = {
  Enterprise: 'Enterprise',
  'Windows AD': 'Windows AD',
  SAML: 'SAML'
};

/**
 * Map a validated plan onto the seed shape the preview already understands.
 *
 * The client name and both contacts come from the **local** assessment, not
 * from the plan — the skill never sees them, so it could not return them.
 * That split is the whole data-protection position in one line of code.
 */
export function planToSeed(plan: QuotePlan, assessment: AssessmentExport): QuoteSeed {
  const hours: Record<string, number> = {};
  const derivations: Record<string, string> = {};
  for (const line of plan.lines) {
    hours[line.code] = line.hours;
    derivations[line.code] =
      line.source === 'model'
        ? `${line.derivation} (proposed by the model${
            typeof line.engineHours === 'number'
              ? `, against ${line.engineHours}h from the engine`
              : ', which the engine does not price'
          })`
        : line.derivation;
  }

  const notes: SeedNote[] = plan.warnings.map((warning) => ({
    id: warning.id,
    // The seed has two severities; an error is not less serious than a warn.
    severity: warning.severity === 'info' ? 'info' : 'warn',
    text: warning.text
  }));

  const bandId = plan.env.migration_band;
  const migrationBand =
    bandId === undefined
      ? null
      : (MIGRATION_BANDS.find((band) => band.id === bandId) ?? null);

  const authRaw = typeof plan.env.auth === 'string' ? plan.env.auth : null;

  return {
    productStack: plan.productStack,
    projectType: plan.route as ProjectType,
    routeReason: plan.routeReason,
    client: String(assessment.client.client ?? ''),
    contactName: String(assessment.client.signOffName ?? ''),
    contactEmail: String(assessment.client.signOffEmail ?? ''),
    environments: plan.env.environments ?? assessment.environments.length,
    testEnvironments: plan.env.test_environments ?? 0,
    devEnvironments: plan.env.dev_environments ?? 0,
    tomcatInstances: plan.env.tomcat_instances ?? 0,
    auth: authRaw ? (AUTH_MODES_BY_NAME[authRaw] ?? null) : null,
    // Band-affecting filestore only — the output repository is instance
    // history and is reported in `env`, not banded on. See AD-17.
    filestoreGb: aggregate(plan.env.input_frs_gb),
    contentCount: aggregate(plan.env.content_count),
    // The plan never decides that conversion is in scope; it asks.
    convertUniverses: false,
    migrationBand,
    hours,
    derivations,
    scope: SCOPE_CATEGORY_IDS.flatMap((category) => plan.scope[category]),
    notes
  };
}

/** Per-line activity text, which the seed has no slot for. */
export function planActivity(plan: QuotePlan): Record<string, string> {
  const activity: Record<string, string> = {};
  for (const line of plan.lines) activity[line.code] = line.activity;
  return activity;
}
