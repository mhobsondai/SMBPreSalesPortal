/*
 * SAP Quote Generator — assessment import model.
 *
 * The rules that turn a completed install assessment into a pre-populated
 * quote: route selection, default line hours, migration bands, and the
 * mapping from assessment fields onto product codes.
 *
 * ── Where this came from, and what it deliberately excludes ──────────
 *
 * Transcribed from `labmat_engine.py` in the `sap-bia-labmat` skill —
 * `resolve_route()`, `build_default_lines()` and `migration_band_hours()`.
 *
 * AD-14 recorded that the skill is *not* the pricing authority for this
 * tool, and that still holds. The boundary is deliberate and narrow:
 *
 *   the skill proposes EFFORT  →  the Quote Generator prices it
 *
 * So the hours below come in. PM tier selection, PM percentages,
 * contingency and every total stay in `sapQuoteGeneratorModel.ts` and are
 * untouched by an import. See AD-15.
 *
 * ── This file is published methodology ───────────────────────────────
 *
 * A pre-filled hour lands in a client quote. Same treatment as the pricing
 * model: same inputs must give the same answer next month, two consultants
 * must agree, and `lib/quoting/__fixtures__/import.json` pins it.
 * Regenerate the fixture in the same commit and say why.
 */

import type { ProjectType } from './sapQuoteGeneratorModel';

/** The export contract this importer understands. Bump = breaking change. */
export const SUPPORTED_ASSESSMENT_SCHEMA_VERSION = 2;
export const ASSESSMENT_TOOL_ID = 'sap-install-assessment';

// ─── Authentication ───────────────────────────────────────────────────

export const AUTH_MODES = ['Enterprise', 'Windows AD', 'SAML'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

/**
 * Platform configuration effort, per environment.
 *
 * Enterprise authentication is self-contained; AD and SAML both mean
 * integrating with something the client already runs, which is the same
 * order of work either way.
 */
export const AUTH_CONFIG_HOURS: Record<AuthMode, number> = {
  Enterprise: 3.75,
  'Windows AD': 7.5,
  SAML: 7.5
};

// ─── The operating system hard rule ───────────────────────────────────

/**
 * An in-place upgrade to 2025 is not possible below Windows Server 2022,
 * so the route is forced to install + migration regardless of preference.
 *
 * This is the single most commercially significant thing the importer
 * infers, because it changes the shape of the whole quote — which is why
 * the inference is always shown and always confirmed rather than applied
 * silently.
 */
export const MINIMUM_IN_PLACE_UPGRADE_OS_YEAR = 2022;

// ─── Migration band ───────────────────────────────────────────────────

export interface MigrationBand {
  id: 'small' | 'medium' | 'large';
  label: string;
  /** Upper bound, inclusive at the top of the band. */
  maxGb: number;
  maxItems: number;
  hours: number;
}

/**
 * Content migration effort, from filestore size and content count.
 *
 * Where size and count fall in different bands, **the higher band wins** —
 * a small filestore with 12,000 objects is still a large migration.
 */
export const MIGRATION_BANDS: ReadonlyArray<MigrationBand> = [
  { id: 'small', label: 'Small', maxGb: 5, maxItems: 1000, hours: 7.5 },
  { id: 'medium', label: 'Medium', maxGb: 15, maxItems: 10000, hours: 15 },
  { id: 'large', label: 'Large', maxGb: Infinity, maxItems: Infinity, hours: 30 }
];

// ─── Default line hours ───────────────────────────────────────────────

/** Product-code suffix, so the same table serves BOBJ and CRY. */
export type LineSuffix =
  | 'DES-CONNECT'
  | 'DES-SOFTWARE'
  | 'DES-PREINSTALL'
  | 'BLD-UPGR-INSTALL'
  | 'BLD-UPGR-TOMCAT'
  | 'BLD-MIGR-INSTALL'
  | 'BLD-MIGR-CONFIG'
  | 'BLD-MIGR-TOMCAT'
  | 'BLD-MIGRATION'
  | 'BLD-DEV-REPORTS'
  | 'UA-TESTING'
  | 'TRN-CLOUDCARE';

/**
 * Fixed default hours — the lines that do not scale with anything.
 *
 * Note the two that read backwards and are correct: `DES-SOFTWARE` is
 * "Pre-Installation Documentation" and `DES-PREINSTALL` is "Software
 * Downloads", in both the skill and the product catalogue. Do not "fix"
 * them.
 */
export const FIXED_DEFAULT_HOURS: Partial<Record<LineSuffix, number>> = {
  'DES-CONNECT': 0.5,
  'DES-SOFTWARE': 1,
  'DES-PREINSTALL': 1,
  'UA-TESTING': 3.75,
  'TRN-CLOUDCARE': 1
};

/** Platform install or upgrade, per environment. */
export const PLATFORM_HOURS_PER_ENVIRONMENT = 7.5;

/** Tomcat install or upgrade, per instance needing configuration. */
export const TOMCAT_HOURS_PER_INSTANCE = 3.75;

/** UNV → UNX conversion and report repointing. BusinessObjects only. */
export const UNIVERSE_CONVERSION_HOURS = 15;

/**
 * Which suffixes each route emits. A quote is one route or the other, and
 * an import must never seed both — `routeConflict()` would fire on its own
 * output.
 */
export const ROUTE_LINES: Record<ProjectType, LineSuffix[]> = {
  upgrade: [
    'DES-CONNECT',
    'DES-SOFTWARE',
    'DES-PREINSTALL',
    'BLD-UPGR-INSTALL',
    'BLD-UPGR-TOMCAT',
    'BLD-DEV-REPORTS',
    'UA-TESTING',
    'TRN-CLOUDCARE'
  ],
  install: [
    'DES-CONNECT',
    'DES-SOFTWARE',
    'DES-PREINSTALL',
    'BLD-MIGR-INSTALL',
    'BLD-MIGR-CONFIG',
    'BLD-MIGR-TOMCAT',
    'BLD-MIGRATION',
    'BLD-DEV-REPORTS',
    'UA-TESTING',
    'TRN-CLOUDCARE'
  ]
};

/**
 * Phases the skill has no opinion about.
 *
 * System Testing, Training, Universe Development and Transition-Operations
 * are real products in the catalogue and are never seeded — an import
 * leaves them at zero for the consultant. Recorded so their absence reads
 * as deliberate rather than as a gap in the mapping.
 */
export const NEVER_SEEDED_NOTE =
  'System Testing, Training, Universe Development and Transition – Operations are never pre-filled. Add them yourself if the engagement needs them.';

// ─── Assessment field mapping ─────────────────────────────────────────

/** `installationType` → product stack name. */
export const INSTALLATION_TYPE_TO_STACK: Record<string, string> = {
  businessobjects: 'SAP Business Objects',
  'crystal-server': 'SAP Crystal Server'
};

/** `installationType` → product-code infix. */
export const INSTALLATION_TYPE_TO_PREFIX: Record<string, 'BOBJ' | 'CRY'> = {
  businessobjects: 'BOBJ',
  'crystal-server': 'CRY'
};

/**
 * Per-environment fields summed into `content_count`.
 *
 * Universes are handled separately because their shape depends on
 * `universeCountMode`, and because on Crystal Server the keys are **absent**
 * rather than null — which means "this platform has none", not "not counted
 * yet". Collapsing those two would price zero universes for an estate with
 * eighty. See AD-11.
 */
export const CONTENT_COUNT_FIELDS = [
  'crystalDocuments',
  'webiDocuments',
  'publications'
] as const;

export const FILESTORE_FIELDS = [
  'inputFileRepositoryGb',
  'outputFileRepositoryGb'
] as const;

/**
 * Scope items ticked when the assessment reports test or development
 * environments.
 *
 * They are ticked, not priced. AD-11 records that test and development
 * environments are counted but never detailed, because they are rebuilt as
 * a copy of the new production — so they are real work with no figures
 * behind them yet. Ticking the scope item and warning is honest; folding
 * them into the environment multiplier would invent effort. See AD-15.
 */
export const TEST_ENVIRONMENT_SCOPE_IDS = ['install_test', 'mig_test'];
export const DEV_ENVIRONMENT_SCOPE_IDS = ['install_dev', 'mig_dev'];

// ─── The API contract for free-text interpretation ────────────────────

/**
 * The **entire** payload sent to the interpretation endpoint.
 *
 * Three strings describing a Windows server. No client name, no contact
 * names, no email addresses, no counts, no sizes — nothing that identifies
 * the engagement or a person.
 *
 * That is the whole reason AD-08's position survives this feature intact:
 * there is no personal data to have a retention policy about. The rest of
 * the assessment is parsed in the browser and never leaves it. See AD-15.
 */
export interface TechnicalStrings {
  operatingSystem: string;
  authentication: string;
  platformSoftware: string;
}

export type InterpretationConfidence = 'high' | 'low' | 'unknown';
export type InterpretationSource = 'local' | 'ai';

export interface OsInterpretation {
  raw: string;
  /** `null` when it could not be determined — never guessed as `false`. */
  preWindowsServer2022: boolean | null;
  detected: string | null;
  confidence: InterpretationConfidence;
  reason: string;
}

export interface AuthInterpretation {
  raw: string;
  auth: AuthMode | null;
  confidence: InterpretationConfidence;
  reason: string;
}

export interface PlatformInterpretation {
  raw: string;
  currentVersion: string | null;
  confidence: InterpretationConfidence;
  reason: string;
}

export interface Interpretation {
  operatingSystem: OsInterpretation;
  authentication: AuthInterpretation;
  platformSoftware: PlatformInterpretation;
  source: InterpretationSource;
}

/** POST target. Gated to `authenticated` in `staticwebapp.config.json`. */
export const INTERPRET_ENDPOINT = '/api/tools/sap-quote/interpret';
