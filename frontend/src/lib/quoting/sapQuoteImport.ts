/**
 * Pre-populate a quote from an install assessment export.
 *
 * Pure functions. No DOM, no network — the one call that does leave the
 * browser lives in `sapQuoteImportApi.ts`, so everything here is testable
 * without stubbing fetch.
 *
 * ── The shape of the thing ────────────────────────────────────────────
 *
 *   paste JSON
 *     → parseAssessmentExport()   strict, refuses anything unrecognised
 *     → technicalStringsFor()     three strings, no personal data
 *     → interpretLocally()        deterministic; enough for most estates
 *     → [ AI only for what is left uncertain ]
 *     → buildSeed()               route, hours, counts, scope
 *     → planImport()              a field-by-field diff
 *     → applyImport()             only what the consultant accepted
 *
 * Nothing is applied without being shown first. The operating-system
 * inference alone can move a quote from an in-place upgrade to a full
 * install plus migration, which is a different engagement at a different
 * price, so it is never allowed to happen silently.
 *
 * ── Personal data ─────────────────────────────────────────────────────
 *
 * The export carries a client name, two contact names and two email
 * addresses. All five are read here, in the browser, and go straight into
 * the form. **None of them is in `TechnicalStrings`**, which is the only
 * thing the API ever sees. AD-08 therefore holds unchanged. See AD-15.
 */

import {
  ASSESSMENT_TOOL_ID,
  AUTH_CONFIG_HOURS,
  AUTH_MODES,
  CONTENT_COUNT_FIELDS,
  DEV_ENVIRONMENT_SCOPE_IDS,
  FILESTORE_FIELDS,
  FIXED_DEFAULT_HOURS,
  INSTALLATION_TYPE_TO_PREFIX,
  INSTALLATION_TYPE_TO_STACK,
  MIGRATION_BANDS,
  MINIMUM_IN_PLACE_UPGRADE_OS_YEAR,
  PLATFORM_HOURS_PER_ENVIRONMENT,
  ROUTE_LINES,
  SUPPORTED_ASSESSMENT_SCHEMA_VERSION,
  TEST_ENVIRONMENT_SCOPE_IDS,
  TOMCAT_HOURS_PER_INSTANCE,
  UNIVERSE_CONVERSION_HOURS,
  type AuthMode,
  type Interpretation,
  type LineSuffix,
  type MigrationBand,
  type TechnicalStrings
} from '../../config/sapQuoteImportModel';
import { formatHours, type QuoteState } from './sapQuoteGenerator';
import type { ProjectType } from '../../config/sapQuoteGeneratorModel';

// ─── The export, as this module understands it ────────────────────────

/**
 * `undefined` (key absent) means not applicable — the platform does not
 * have this. `null` means applicable but not yet answered. A value means
 * answered, or implied by another answer. See AD-11 and AD-12.
 */
export type AssessmentAnswer = string | number | null | undefined;
export type AssessmentAnswers = Record<string, AssessmentAnswer>;

export interface AssessmentEnvironment {
  id: string;
  label: string;
  answers: AssessmentAnswers;
}

export interface AssessmentExport {
  schemaVersion: number;
  tool: string;
  installationType: string;
  client: AssessmentAnswers;
  environments: AssessmentEnvironment[];
  completeness?: { required: number; answered: number; isComplete: boolean };
  advisories?: Array<{ id: string; scope?: string; text: string }>;
}

export type ParseResult =
  | { ok: true; export: AssessmentExport }
  | { ok: false; error: string };

/**
 * Strict, and deliberately unhelpful about near-misses.
 *
 * A half-understood assessment produces a quote nobody can audit, so
 * anything unrecognised is refused outright rather than repaired — the same
 * posture `deserialise()` takes for a saved quote.
 */
export function parseAssessmentExport(raw: string): ParseResult {
  const text = raw.trim();
  if (text === '') return { ok: false, error: 'Nothing pasted.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That is not valid JSON.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Expected a JSON object.' };
  }

  const c = parsed as Partial<AssessmentExport>;

  if (c.tool !== ASSESSMENT_TOOL_ID) {
    return {
      ok: false,
      error: `This is not an install assessment export (tool: ${
        typeof c.tool === 'string' ? c.tool : 'missing'
      }).`
    };
  }
  if (c.schemaVersion !== SUPPORTED_ASSESSMENT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Assessment schema v${String(
        c.schemaVersion
      )} — this importer reads v${SUPPORTED_ASSESSMENT_SCHEMA_VERSION}. Re-export from the install assessment.`
    };
  }
  if (typeof c.installationType !== 'string' || !INSTALLATION_TYPE_TO_STACK[c.installationType]) {
    return { ok: false, error: `Unrecognised installation type: ${String(c.installationType)}.` };
  }
  if (!c.client || typeof c.client !== 'object') {
    return { ok: false, error: 'The export has no client section.' };
  }
  if (!Array.isArray(c.environments) || c.environments.length === 0) {
    return { ok: false, error: 'The export lists no environments.' };
  }
  for (const environment of c.environments) {
    if (
      !environment ||
      typeof environment.id !== 'string' ||
      typeof environment.label !== 'string' ||
      !environment.answers ||
      typeof environment.answers !== 'object'
    ) {
      return { ok: false, error: 'An environment in the export is malformed.' };
    }
  }

  return { ok: true, export: c as AssessmentExport };
}

// ─── Reading answers, honouring all three states ──────────────────────

export type AnswerState = 'absent' | 'unanswered' | 'answered';

export function answerState(answers: AssessmentAnswers, key: string): AnswerState {
  if (!(key in answers)) return 'absent';
  const value = answers[key];
  if (value === null || value === undefined) return 'unanswered';
  if (typeof value === 'string' && value.trim() === '') return 'unanswered';
  return 'answered';
}

function text(answers: AssessmentAnswers, key: string): string {
  const value = answers[key];
  return typeof value === 'string' ? value.trim() : '';
}

function numeric(answers: AssessmentAnswers, key: string): number | undefined {
  const value = answers[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function isYes(answers: AssessmentAnswers, key: string): boolean {
  return text(answers, key).toLowerCase() === 'yes';
}

/**
 * A number summed across environments, with the gaps named.
 *
 * `unknown` lists fields that apply but were not answered. It is the
 * difference between "this estate has no universes" and "nobody counted the
 * universes", and it is why a partial assessment produces a flagged quote
 * rather than a confidently wrong one.
 */
export interface Aggregate {
  total: number;
  unknown: string[];
}

function sumAcross(
  environments: AssessmentEnvironment[],
  fields: readonly string[]
): Aggregate {
  let total = 0;
  const unknown: string[] = [];
  for (const environment of environments) {
    for (const field of fields) {
      switch (answerState(environment.answers, field)) {
        case 'answered':
          total += numeric(environment.answers, field) ?? 0;
          break;
        case 'unanswered':
          unknown.push(`${environment.label}: ${field}`);
          break;
        case 'absent':
          // Not applicable to this platform. Contributes a real zero.
          break;
      }
    }
  }
  return { total, unknown };
}

/**
 * Universe count, which needs its own reader.
 *
 * `universeCountMode` decides which keys carry the answer, and on Crystal
 * Server the whole group is absent rather than null — a genuine zero.
 */
export function universeCount(environment: AssessmentEnvironment): Aggregate {
  const { answers, label } = environment;
  const mode = answerState(answers, 'universeCountMode');

  if (mode === 'absent') return { total: 0, unknown: [] };
  if (mode === 'unanswered') return { total: 0, unknown: [`${label}: universeCountMode`] };

  if (text(answers, 'universeCountMode') === 'combined') {
    return sumAcross([environment], ['combinedUniverseCount']);
  }
  return sumAcross([environment], ['unvCount', 'unxCount']);
}

// ─── Local interpretation of the free-text fields ─────────────────────

/*
 * Two patterns, tried in order.
 *
 * The full year covers "Windows Server 2016" and "Windows Server 2012 R2".
 * The 2K shorthand needs its own, and deliberately does not require a
 * trailing word boundary: "W2K12R2" has no break between the year and the
 * R2, so a `\b` there would miss it — which is exactly the abbreviation a
 * consultant types on a call.
 */
const OS_FULL_YEAR = /(?:^|\D)(20\d{2})(?!\d)/;
const OS_SHORTHAND = /\bw?2k(\d{2})/i;
const NON_WINDOWS = /\b(linux|rhel|red\s*hat|suse|sles|ubuntu|centos|aix|solaris|unix)\b/i;
const VERSION = /\b(\d+\.\d+)(?:\s*sp\s*(\d+))?\b/i;
const YEAR_VERSION = /\b(20\d{2})\b/;

/**
 * Deterministic best effort, run before anything is sent anywhere.
 *
 * Most estates answer "Windows Server 2016" and "Windows AD", which needs
 * no model at all. The API is for the rest — "W2K12R2 Datacenter", "AD with
 * SSO via Kerberos", "SAML2 through ADFS" — and calling it only when local
 * parsing is uncertain keeps the tool working, and fast, when the API is
 * unavailable.
 */
export function interpretLocally(strings: TechnicalStrings): Interpretation {
  return {
    operatingSystem: interpretOs(strings.operatingSystem),
    authentication: interpretAuth(strings.authentication),
    platformSoftware: interpretPlatform(strings.platformSoftware),
    source: 'local'
  };
}

function interpretOs(raw: string): Interpretation['operatingSystem'] {
  const value = raw.trim();
  if (value === '') {
    return {
      raw,
      preWindowsServer2022: null,
      detected: null,
      confidence: 'unknown',
      reason: 'No operating system recorded in the assessment.'
    };
  }

  if (NON_WINDOWS.test(value)) {
    return {
      raw,
      preWindowsServer2022: null,
      detected: value,
      confidence: 'unknown',
      reason:
        'This looks like a non-Windows platform. The pre-Windows Server 2022 rule does not apply as written — decide the route yourself.'
    };
  }

  const full = OS_FULL_YEAR.exec(value);
  const short = full ? null : OS_SHORTHAND.exec(value);
  if (!full && !short) {
    return {
      raw,
      preWindowsServer2022: null,
      detected: null,
      confidence: 'unknown',
      reason: 'Could not read a Windows Server version from this.'
    };
  }

  const year = full
    ? Number.parseInt(full[1], 10)
    : Number.parseInt(`20${short![1]}`, 10);
  const pre = year < MINIMUM_IN_PLACE_UPGRADE_OS_YEAR;
  return {
    raw,
    preWindowsServer2022: pre,
    detected: `Windows Server ${year}`,
    confidence: 'high',
    reason: pre
      ? `Windows Server ${year} is earlier than ${MINIMUM_IN_PLACE_UPGRADE_OS_YEAR}, so an in-place upgrade is not possible — install and migration.`
      : `Windows Server ${year} supports an in-place upgrade.`
  };
}

function interpretAuth(raw: string): Interpretation['authentication'] {
  const value = raw.trim();
  const lower = value.toLowerCase();

  if (value === '') {
    return { raw, auth: null, confidence: 'unknown', reason: 'No authentication recorded.' };
  }

  // SAML first: "SAML via ADFS" would otherwise trip the AD test.
  if (/\b(saml|adfs|federat)/i.test(lower)) {
    return { raw, auth: 'SAML', confidence: 'high', reason: 'Reads as SAML / federated sign-on.' };
  }
  if (/\b(windows\s*ad|active\s*directory|kerberos|ntlm|\bad\b)/i.test(lower)) {
    return { raw, auth: 'Windows AD', confidence: 'high', reason: 'Reads as Windows AD.' };
  }
  if (/\benterprise\b/i.test(lower)) {
    return {
      raw,
      auth: 'Enterprise',
      confidence: 'high',
      reason: 'Reads as Enterprise (platform-native) authentication.'
    };
  }
  /*
   * LDAP is a real answer the assessment invites — its placeholder says
   * "e.g. Enterprise, Windows AD, LDAP" — but the effort model has only
   * three modes and LDAP is not one of them. Rather than quietly filing it
   * under Windows AD and pricing 7.5 hours on a guess, it is surfaced.
   * See AD-15.
   */
  if (/\bldap\b/i.test(lower)) {
    return {
      raw,
      auth: null,
      confidence: 'low',
      reason:
        'LDAP is not one of the three modes the effort model prices. Pick the closest — Windows AD is usually right — and check the configuration hours.'
    };
  }
  return { raw, auth: null, confidence: 'unknown', reason: 'Could not match this to a known mode.' };
}

function interpretPlatform(raw: string): Interpretation['platformSoftware'] {
  const value = raw.trim();
  if (value === '') {
    return { raw, currentVersion: null, confidence: 'unknown', reason: 'No platform version recorded.' };
  }
  const match = VERSION.exec(value);
  if (match) {
    const version = match[2] ? `${match[1]} SP${match[2]}` : match[1];
    return { raw, currentVersion: version, confidence: 'high', reason: `Read as version ${version}.` };
  }
  const year = YEAR_VERSION.exec(value);
  if (year) {
    return {
      raw,
      currentVersion: year[1],
      confidence: 'high',
      reason: `Read as the ${year[1]} release.`
    };
  }
  return { raw, currentVersion: null, confidence: 'unknown', reason: 'Could not read a version.' };
}

/** True when anything is still uncertain and the API is worth calling. */
export function needsInterpretation(interpretation: Interpretation): boolean {
  return (
    interpretation.operatingSystem.confidence !== 'high' ||
    interpretation.authentication.confidence !== 'high' ||
    interpretation.platformSoftware.confidence !== 'high'
  );
}

/**
 * The only thing that ever leaves the browser.
 *
 * Takes the first production environment's technical strings. Nothing here
 * names a person, a client or an engagement — see the note on
 * `TechnicalStrings`.
 */
export function technicalStringsFor(assessment: AssessmentExport): TechnicalStrings {
  const first = assessment.environments[0]?.answers ?? {};
  return {
    operatingSystem: text(first, 'operatingSystem'),
    authentication: text(first, 'authentication'),
    platformSoftware: text(first, 'platformSoftware')
  };
}

/** Belt and braces: assert the payload carries nothing personal. */
export function containsPersonalData(payload: TechnicalStrings): boolean {
  return Object.values(payload).some((value) => /@/.test(value));
}

// ─── Migration band ───────────────────────────────────────────────────

export function migrationBandFor(gb: number, items: number): MigrationBand {
  const bySize = MIGRATION_BANDS.findIndex((b) => gb <= b.maxGb);
  const byCount = MIGRATION_BANDS.findIndex((b) => items < b.maxItems);
  const size = bySize === -1 ? MIGRATION_BANDS.length - 1 : bySize;
  const count = byCount === -1 ? MIGRATION_BANDS.length - 1 : byCount;
  // Different bands → the higher one wins.
  return MIGRATION_BANDS[Math.max(size, count)];
}

// ─── The seed ─────────────────────────────────────────────────────────

export interface SeedNote {
  id: string;
  text: string;
  severity: 'info' | 'warn';
}

export interface QuoteSeed {
  productStack: string;
  projectType: ProjectType;
  routeReason: string;
  client: string;
  contactName: string;
  contactEmail: string;
  /** Production environments only — see the note in `buildSeed`. */
  environments: number;
  testEnvironments: number;
  devEnvironments: number;
  tomcatInstances: number;
  auth: AuthMode | null;
  filestoreGb: Aggregate;
  contentCount: Aggregate;
  convertUniverses: boolean;
  migrationBand: MigrationBand | null;
  /** Product code → default hours. */
  hours: Record<string, number>;
  /** Product code → why that number. */
  derivations: Record<string, string>;
  /** Scope item ids to tick. */
  scope: string[];
  notes: SeedNote[];
}

/**
 * Turn a parsed assessment plus an interpretation into everything the quote
 * needs.
 *
 * **Multi-environment estates.** The assessment is per production
 * environment; the effort model takes one count. Production environments
 * multiply platform install and configuration effort; filestore sizes and
 * content counts are summed across them, and the migration band is taken
 * once from those totals.
 *
 * That loses one thing worth knowing: two 8 GB estates band as one 16 GB
 * migration (Large) rather than two Medium ones, which under-prices two
 * genuinely separate cutovers. Flagged as a note rather than modelled,
 * because changing the band arithmetic would be a pricing decision.
 * See AD-15.
 *
 * Test and development environments are **counted and scoped, never
 * priced** — AD-11 records that they are rebuilt as a copy of the new
 * production, so nothing in the assessment sizes them.
 */
export function buildSeed(
  assessment: AssessmentExport,
  interpretation: Interpretation
): QuoteSeed {
  const notes: SeedNote[] = [];
  const productStack = INSTALLATION_TYPE_TO_STACK[assessment.installationType];
  const prefix = INSTALLATION_TYPE_TO_PREFIX[assessment.installationType];
  const environments = assessment.environments;
  const client = assessment.client;

  // ── Route ──────────────────────────────────────────────────────────
  const osByEnvironment = environments.map((e) => text(e.answers, 'operatingSystem'));
  const distinctOs = [...new Set(osByEnvironment.filter((o) => o !== ''))];
  if (distinctOs.length > 1) {
    notes.push({
      id: 'os-heterogeneous',
      severity: 'warn',
      text: `The production environments do not all run the same operating system (${distinctOs.join(
        ', '
      )}). The route was decided from the first one — check the others can take it.`
    });
  }

  const pre = interpretation.operatingSystem.preWindowsServer2022;
  let projectType: ProjectType;
  let routeReason: string;
  if (pre === true) {
    projectType = 'install';
    routeReason = interpretation.operatingSystem.reason;
  } else if (pre === false) {
    projectType = 'upgrade';
    routeReason = interpretation.operatingSystem.reason;
  } else {
    projectType = 'upgrade';
    routeReason = `Route not determined from the operating system (${interpretation.operatingSystem.reason}) — defaulted to an in-place upgrade. Confirm this.`;
    notes.push({ id: 'route-unconfirmed', severity: 'warn', text: routeReason });
  }

  // ── Counts ─────────────────────────────────────────────────────────
  const productionCount = environments.length;
  const testCount = isYes(client, 'hasTestEnvironments')
    ? (numeric(client, 'testEnvironmentCount') ?? 0)
    : 0;
  const devCount = isYes(client, 'hasDevEnvironments')
    ? (numeric(client, 'devEnvironmentCount') ?? 0)
    : 0;

  const tomcatInstances = environments.filter(
    (e) => isYes(e.answers, 'separateTomcat') || isYes(e.answers, 'externallyFacing')
  ).length;

  const filestoreGb = sumAcross(environments, FILESTORE_FIELDS);
  const content = sumAcross(environments, CONTENT_COUNT_FIELDS);
  const universes = environments.map(universeCount);
  const contentCount: Aggregate = {
    total: content.total + universes.reduce((n, u) => n + u.total, 0),
    unknown: [...content.unknown, ...universes.flatMap((u) => u.unknown)]
  };

  if (filestoreGb.unknown.length > 0 || contentCount.unknown.length > 0) {
    notes.push({
      id: 'incomplete-sizing',
      severity: 'warn',
      text: `The migration band is derived from figures the assessment does not have yet: ${[
        ...filestoreGb.unknown,
        ...contentCount.unknown
      ].join(', ')}. Treat the migration hours as provisional.`
    });
  }

  if (productionCount > 1) {
    notes.push({
      id: 'multi-environment-band',
      severity: 'warn',
      text: `${productionCount} production environments. Filestore sizes and content counts are summed, so the migration is banded once on the combined total rather than once per environment — which can under-price separate cutovers.`
    });
  }

  // ── Universe conversion ────────────────────────────────────────────
  let convertUniverses = false;
  if (prefix === 'BOBJ') {
    const mode = environments.map((e) => text(e.answers, 'universeCountMode'));
    const unv = environments.reduce(
      (n, e) => n + (numeric(e.answers, 'unvCount') ?? 0),
      0
    );
    if (mode.includes('separate') && unv > 0) {
      convertUniverses = true;
    } else if (mode.includes('combined')) {
      convertUniverses = true;
      notes.push({
        id: 'universe-split-unknown',
        severity: 'warn',
        text: 'Universes were counted as a combined total, so the UNV/UNX split is unknown. Conversion has been assumed — remove it if they are already all UNX.'
      });
    }
  }

  // ── Default hours ──────────────────────────────────────────────────
  const auth = interpretation.authentication.auth;
  const hours: Record<string, number> = {};
  const derivations: Record<string, string> = {};
  const code = (suffix: LineSuffix) => `DI-BIA-SAP-${prefix}-${suffix}`;

  const migrationBand =
    projectType === 'install'
      ? migrationBandFor(filestoreGb.total, contentCount.total)
      : null;

  const put = (suffix: LineSuffix, value: number, why: string) => {
    if (value <= 0) return;
    hours[code(suffix)] = value;
    derivations[code(suffix)] = why;
  };

  for (const suffix of ROUTE_LINES[projectType]) {
    const fixed = FIXED_DEFAULT_HOURS[suffix];
    if (fixed !== undefined) {
      put(suffix, fixed, 'Standard allowance.');
      continue;
    }
    switch (suffix) {
      case 'BLD-UPGR-INSTALL':
      case 'BLD-MIGR-INSTALL':
        put(
          suffix,
          PLATFORM_HOURS_PER_ENVIRONMENT * productionCount,
          `${formatHours(PLATFORM_HOURS_PER_ENVIRONMENT)}h × ${productionCount} production environment${
            productionCount === 1 ? '' : 's'
          }.`
        );
        break;
      case 'BLD-MIGR-CONFIG':
        if (auth) {
          put(
            suffix,
            AUTH_CONFIG_HOURS[auth] * productionCount,
            `${formatHours(AUTH_CONFIG_HOURS[auth])}h for ${auth} × ${productionCount} environment${
              productionCount === 1 ? '' : 's'
            }.`
          );
        } else {
          notes.push({
            id: 'auth-unknown',
            severity: 'warn',
            text: `Configuration hours were not pre-filled: ${interpretation.authentication.reason}`
          });
        }
        break;
      case 'BLD-UPGR-TOMCAT':
      case 'BLD-MIGR-TOMCAT':
        put(
          suffix,
          TOMCAT_HOURS_PER_INSTANCE * tomcatInstances,
          `${formatHours(TOMCAT_HOURS_PER_INSTANCE)}h × ${tomcatInstances} Tomcat instance${
            tomcatInstances === 1 ? '' : 's'
          } (separate Tomcat or externally facing).`
        );
        break;
      case 'BLD-MIGRATION':
        if (migrationBand) {
          put(
            suffix,
            migrationBand.hours,
            `${migrationBand.label} migration band — ${filestoreGb.total} GB filestore, ${contentCount.total} content items.`
          );
        }
        break;
      case 'BLD-DEV-REPORTS':
        if (convertUniverses) {
          put(suffix, UNIVERSE_CONVERSION_HOURS, 'UNV → UNX conversion and report repointing for 2025.');
        }
        break;
      default:
        break;
    }
  }

  // ── Scope ──────────────────────────────────────────────────────────
  const scope: string[] = [];
  if (convertUniverses) scope.push('conv_universe', 'conv_repoint');
  if (testCount > 0) {
    scope.push(...TEST_ENVIRONMENT_SCOPE_IDS);
    notes.push({
      id: 'test-environments',
      severity: 'warn',
      text: `${testCount} test environment${
        testCount === 1 ? '' : 's'
      } reported. Added to scope but not costed — the assessment records only the count, so there is nothing to size them from.`
    });
  }
  if (devCount > 0) {
    scope.push(...DEV_ENVIRONMENT_SCOPE_IDS);
    notes.push({
      id: 'dev-environments',
      severity: 'warn',
      text: `${devCount} development environment${
        devCount === 1 ? '' : 's'
      } reported. Added to scope but not costed, for the same reason.`
    });
  }

  if (tomcatInstances > 0) {
    notes.push({
      id: 'tomcat-scoped',
      severity: 'info',
      text: 'Tomcat work is costed, so remove the Tomcat exclusion on the Dependencies & Assumptions step before issuing.'
    });
  }

  if (assessment.completeness && !assessment.completeness.isComplete) {
    notes.push({
      id: 'assessment-incomplete',
      severity: 'warn',
      text: `The assessment is incomplete — ${assessment.completeness.answered} of ${assessment.completeness.required} applicable fields answered.`
    });
  }

  for (const advisory of assessment.advisories ?? []) {
    notes.push({
      id: `advisory-${advisory.id}`,
      severity: 'info',
      text: `${advisory.scope ? `[${advisory.scope}] ` : ''}${advisory.text}`
    });
  }

  return {
    productStack,
    projectType,
    routeReason,
    client: text(client, 'client'),
    contactName: text(client, 'signOffName') || text(client, 'technicalContactName'),
    contactEmail: text(client, 'signOffEmail') || text(client, 'technicalContactEmail'),
    environments: productionCount,
    testEnvironments: testCount,
    devEnvironments: devCount,
    tomcatInstances,
    auth,
    filestoreGb,
    contentCount,
    convertUniverses,
    migrationBand,
    hours,
    derivations,
    scope,
    notes
  };
}

// ─── The plan ─────────────────────────────────────────────────────────

export type ImportChange =
  | {
      kind: 'field';
      id: string;
      group: ImportGroup;
      label: string;
      field: 'client' | 'contactName' | 'contactEmail' | 'productStack' | 'projectType';
      value: string;
      from: string;
      to: string;
      note?: string;
    }
  | {
      kind: 'hours';
      id: string;
      group: 'hours';
      label: string;
      code: string;
      value: number;
      from: string;
      to: string;
      note?: string;
    }
  | {
      kind: 'scope';
      id: string;
      group: 'scope';
      label: string;
      scopeId: string;
      value: boolean;
      from: string;
      to: string;
      note?: string;
    };

export type ImportGroup = 'identity' | 'setup' | 'hours' | 'scope';

export interface ImportPlan {
  changes: ImportChange[];
  notes: SeedNote[];
  seed: QuoteSeed;
  /** Changes that would overwrite something already entered. */
  conflicts: string[];
}

const GROUP_ORDER: ImportGroup[] = ['identity', 'setup', 'hours', 'scope'];

/**
 * A field-by-field diff of what the import would do.
 *
 * Every change is offered individually. Nothing is applied here — this
 * function is a description, and `applyImport()` is the only thing that
 * changes state.
 */
export function planImport(state: QuoteState, seed: QuoteSeed): ImportPlan {
  const changes: ImportChange[] = [];
  const conflicts: string[] = [];

  const field = (
    id: string,
    group: ImportGroup,
    label: string,
    fieldName: 'client' | 'contactName' | 'contactEmail' | 'productStack' | 'projectType',
    value: string,
    note?: string
  ) => {
    const current = String(state[fieldName] ?? '');
    if (current === value) return;
    if (current.trim() !== '') conflicts.push(id);
    changes.push({
      kind: 'field',
      id,
      group,
      label,
      field: fieldName,
      value,
      from: current || '—',
      to: value || '—',
      note
    });
  };

  field('client', 'identity', 'Client', 'client', seed.client);
  field('contactName', 'identity', 'Contact name', 'contactName', seed.contactName);
  field('contactEmail', 'identity', 'Contact email', 'contactEmail', seed.contactEmail);
  field('productStack', 'setup', 'Product', 'productStack', seed.productStack);
  field('projectType', 'setup', 'Project type', 'projectType', seed.projectType, seed.routeReason);

  for (const [code, value] of Object.entries(seed.hours)) {
    const current = state.hours[code] ?? 0;
    if (current === value) continue;
    if (current > 0) conflicts.push(code);
    changes.push({
      kind: 'hours',
      id: code,
      group: 'hours',
      label: code,
      code,
      value,
      from: current > 0 ? `${formatHours(current)}h` : '—',
      to: `${formatHours(value)}h`,
      note: seed.derivations[code]
    });
  }

  for (const scopeId of seed.scope) {
    if (state.inScope[scopeId] === true) continue;
    changes.push({
      kind: 'scope',
      id: `scope-${scopeId}`,
      group: 'scope',
      label: scopeId,
      scopeId,
      value: true,
      from: 'Not in scope',
      to: 'In scope'
    });
  }

  changes.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));

  return { changes, notes: seed.notes, seed, conflicts };
}

/**
 * Apply the accepted subset of a plan.
 *
 * `accepted` holds change ids. A change not in the set is not applied — so
 * rejecting the route inference leaves the existing project type alone, and
 * with it the scope and exclusions that hang off it.
 *
 * Project type is applied through `withProjectType` semantics deliberately
 * **not** used here: resetting the content lists mid-import would discard
 * edits the consultant had already made and was not shown in the diff. The
 * page handles that reset explicitly, with its own confirmation.
 */
export function applyImport(
  state: QuoteState,
  plan: ImportPlan,
  accepted: ReadonlySet<string>
): QuoteState {
  let next: QuoteState = {
    ...state,
    hours: { ...state.hours },
    activity: { ...state.activity },
    inScope: { ...state.inScope }
  };

  for (const change of plan.changes) {
    if (!accepted.has(change.id)) continue;
    switch (change.kind) {
      case 'field':
        next = { ...next, [change.field]: change.value };
        break;
      case 'hours':
        next.hours[change.code] = change.value;
        break;
      case 'scope':
        next.inScope[change.scopeId] = change.value;
        break;
    }
  }

  return next;
}

/** Every change id, for the "accept all" default. */
export function allChangeIds(plan: ImportPlan): Set<string> {
  return new Set(plan.changes.map((c) => c.id));
}

// ─── Summary for the preview header ───────────────────────────────────

export function seedSummaryLines(seed: QuoteSeed): string[] {
  const lines: string[] = [];
  lines.push(`${seed.productStack} — ${seed.projectType === 'install' ? 'install and migration' : 'in-place upgrade'}`);
  lines.push(seed.routeReason);
  lines.push(
    `${seed.environments} production environment${seed.environments === 1 ? '' : 's'}` +
      (seed.testEnvironments ? `, ${seed.testEnvironments} test` : '') +
      (seed.devEnvironments ? `, ${seed.devEnvironments} development` : '')
  );
  lines.push(
    `Filestore ${seed.filestoreGb.total} GB · ${seed.contentCount.total} content items` +
      (seed.migrationBand ? ` · ${seed.migrationBand.label} migration band` : '')
  );
  if (seed.auth) lines.push(`Authentication: ${seed.auth}`);
  if (seed.tomcatInstances > 0) {
    lines.push(`${seed.tomcatInstances} Tomcat instance${seed.tomcatInstances === 1 ? '' : 's'}`);
  }
  return lines;
}

export { AUTH_MODES };
