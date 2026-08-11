/**
 * The `sap-quote-plan` v1 contract.
 *
 * What the `sap-bia-quote-plan` skill returns from
 * `POST /api/tools/sap-quote/plan`, and the allowlist that decides what is
 * sent to it. Data and types only — every validator lives in
 * `lib/quoting/sapQuotePlan.ts`, per the tool pattern.
 *
 * Versioned with the same discipline as `ASSESSMENT_SCHEMA_VERSION`: a
 * response carrying a different `schemaVersion` is rejected, not coerced.
 * See AD-17.
 */

import type { ScopeCategoryId } from './sapQuoteGeneratorModel';

// ─── Envelope ─────────────────────────────────────────────────────────

export const PLAN_SCHEMA_VERSION = 1;
export const PLAN_TOOL = 'sap-quote-plan';
export const PLAN_ENDPOINT = '/api/tools/sap-quote/plan';

/**
 * Client-side ceiling on how long to wait.
 *
 * The Static Web Apps gateway cuts every API request at about 45 seconds —
 * a blanket platform constraint, not a plan limit, and it applies to linked
 * backends as well as managed ones. Giving up at 40 leaves the app failing
 * in its own words rather than surfacing a gateway 500 the consultant
 * cannot act on. See AD-17.
 */
export const PLAN_TIMEOUT_MS = 40_000;

// ─── The response ─────────────────────────────────────────────────────

/**
 * Where a line's hours came from.
 *
 * `engine` — produced by a deterministic rule in the skill and reproducible
 * next month. `model` — proposed or adjusted by judgement, and not.
 *
 * The distinction exists because the model is permitted to adjust any line
 * (AD-17). Rendering the two identically would hide which numbers a second
 * consultant would arrive at independently and which they would not.
 */
export type PlanLineSource = 'engine' | 'model';

export interface PlanLine {
  /** Must exist in `sapQuoteProducts.json`. Never contingency, never PM. */
  code: string;
  /** Base hours, greater than zero. The app derives everything else. */
  hours: number;
  /** The task description that appears against the line. */
  activity: string;
  /** Why this number. Required on every line, without exception. */
  derivation: string;
  source: PlanLineSource;
  /** Required when `source` is `model`: the engine's own figure, or null. */
  engineHours?: number | null;
}

export type PlanScope = Record<ScopeCategoryId, string[]>;

export type PlanWarningSeverity = 'info' | 'warn' | 'error';

export interface PlanWarning {
  id: string;
  severity: PlanWarningSeverity;
  text: string;
}

/**
 * The inputs the skill derived, echoed for audit.
 *
 * **Rendered in the preview, never applied.** The engine is deterministic;
 * the reading of a free-text operating system is not. So the derived inputs
 * have to be visible and confirmable, or the hours are unauditable.
 *
 * Deliberately loose — the skill may report more than the app understands,
 * and an unknown key is information rather than an error.
 */
export interface PlanEnv {
  product?: string;
  os?: string | null;
  /** `null`, never `false`, when the string names no Windows Server edition. */
  os_pre_ws2022?: boolean | null;
  auth?: string | null;
  auth_raw?: string | null;
  environments?: number;
  test_environments?: number;
  dev_environments?: number;
  tomcat_instances?: number;
  /** The content itself. This drives the migration band, not the total. */
  input_frs_gb?: number;
  /** Scheduled instance history. Reported, deliberately not banded on. */
  output_frs_gb?: number;
  total_frs_gb?: number;
  content_count?: number;
  successful_instances?: number | null;
  pending_instances?: number | null;
  instances_required?: string | null;
  current_version?: string | null;
  migration_band?: 'small' | 'medium' | 'large';
  universe_count_mode?: 'separate' | 'combined' | null;
  unv_count?: number | null;
  unx_count?: number | null;
  combined_universe_count?: number | null;
  [key: string]: unknown;
}

export interface QuotePlan {
  schemaVersion: number;
  tool: string;
  route: 'install' | 'upgrade';
  routeReason: string;
  productStack: string;
  lines: PlanLine[];
  scope: PlanScope;
  customScope: PlanScope;
  dependencies: string[];
  assumptions: string[];
  exclusions: string[];
  /** Carries `{client}` and `{product}` **unsubstituted** — the app fills both. */
  intro: string;
  env: PlanEnv;
  warnings: PlanWarning[];
}

// ─── The request ──────────────────────────────────────────────────────

/**
 * The payload is **built from these fields**, not cleaned of others.
 *
 * AD-15 could say nothing personal left the browser because the payload was
 * three strings. This sends an assessment, so the same guarantee has to come
 * from construction instead: if a field is not named here it cannot be in
 * the request, whatever it contains.
 *
 * That matters more than a denylist of the five obvious ones.
 * `futureDirection` and `adjacentWork` are free text and have carried a
 * colleague's name and a direct quote about them; `serverName` carries a
 * live hostname. None of them appear below, so none of them travel.
 *
 * Every field here is one the skill's engine actually reads. See AD-17.
 */
export const PLAN_PAYLOAD_CLIENT_FIELDS = [
  'installationType',
  'productionEnvironmentCount',
  'hasTestEnvironments',
  'testEnvironmentCount',
  'hasDevEnvironments',
  'devEnvironmentCount',
  'trainingBiLaunchpad',
  'trainingCms',
  'trainingWebi',
  'trainingInformationDesignTool',
  'trainingCrystalReports',
  'trainingUniverseConversion',
  'goLiveTiming',
  'goLiveWeekday',
  'universeModifiers'
] as const;

export const PLAN_PAYLOAD_ANSWER_FIELDS = [
  'operatingSystem',
  'platformSoftware',
  'authentication',
  'separateTomcat',
  'externallyFacing',
  'inputFileRepositoryGb',
  'outputFileRepositoryGb',
  'universeCountMode',
  'unvCount',
  'unxCount',
  'combinedUniverseCount',
  'crystalDocuments',
  'webiDocuments',
  'publications',
  'pendingInstances',
  'successfulInstances',
  'successfulInstancesRequired',
  'destinationChangesRequired'
] as const;

/**
 * Fields the assessment carries that are **never** sent.
 *
 * Listed for the test that asserts it, and so the omission reads as a
 * decision rather than an oversight. Not used to filter anything — the
 * allowlist above does that.
 */
export const PLAN_PAYLOAD_WITHHELD_FIELDS = [
  'client',
  'technicalContactName',
  'technicalContactEmail',
  'signOffName',
  'signOffEmail',
  'conversationDate',
  'consumers',
  'reportModifiers',
  'futureDirection',
  'adjacentWork',
  'serverName',
  'webServerName',
  'clustered',
  'httpsConfigured',
  'separateWebServer',
  'cmsDatabaseSoftware',
  'auditingEnabled',
  'destinationChangesNarrative',
  'successfulInstancesNarrative'
] as const;

/**
 * What the import panel tells the consultant, verbatim.
 *
 * AD-08's pattern is that the UI states the data-protection position so the
 * claim is visible and therefore has to stay true. The position has changed
 * since AD-08 — a server round trip now happens — so the wording changes
 * with it. The pattern does not.
 */
export const PLAN_PRIVACY_NOTICE =
  'The technical detail of this assessment is sent to Anthropic for analysis. ' +
  'The client name, both contact names and both email addresses are not sent — ' +
  'they stay in this browser and go straight into the quote.';
