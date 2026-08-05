/*
 * SAP Quote Generator — declarative model.
 *
 * Rebuilt from the standalone `bobj_generator.html` prototype. Everything
 * numeric or client-facing lives here; `lib/quoting/` holds the arithmetic
 * and knows nothing about wording.
 *
 * ── This file is published methodology ───────────────────────────────
 *
 * The day length, contingency rate, PM tier thresholds and PM percentages
 * determine numbers that go into a client quote. Per AD-08 and AD-09:
 *
 *   - the same inputs must produce the same answer next month
 *   - two consultants must get the same figure
 *   - `lib/quoting/__fixtures__/reference.json` pins it
 *
 * Changing any of it is a pricing decision. Regenerate the fixture in the
 * same commit (`npm run fixtures:update`) and say why in the message.
 * Never adjust a fixture to make a test pass.
 *
 * The scope, dependency, assumption and exclusion text is not arithmetic
 * but it is client-facing and it is filed, so it gets the same care.
 * See AD-14 for where each list came from.
 */

import PRODUCT_CATALOGUE from './sapQuoteProducts.json';

/** Bumped when the shape of a persisted quote changes. Scopes the storage key. */
export const QUOTE_SCHEMA_VERSION = 1;

/**
 * A working day. The prototype read this from `json/day_length.json` at
 * runtime with a 7.5 fallback; there is no deployment in which it differs,
 * so it is a constant here and a runtime fetch that could silently fail is
 * one less thing to go wrong.
 */
export const HOURS_PER_DAY = 7.5;

/**
 * Contingency, applied per phase and again to project management.
 *
 * Fixed-price work carries it; target-price work does not, because the
 * customer is billed for actual time and the risk is not ours to price.
 */
export const CONTINGENCY_RATE = { Fixed: 0.2, Target: 0 } as const;

export type PricingBasis = keyof typeof CONTINGENCY_RATE;
export const PRICING_BASES = ['Fixed', 'Target'] as const;

/** Fallback day rate, used only if the catalogue carries no price at all. */
export const FALLBACK_DAY_RATE = 1200;

export type ProjectType = 'install' | 'upgrade';

export const PROJECT_TYPES: ReadonlyArray<{ id: ProjectType; label: string }> = [
  { id: 'install', label: 'New Installation' },
  { id: 'upgrade', label: 'In-Place Upgrade' }
];

// ─── Product catalogue ────────────────────────────────────────────────

export interface CatalogueProduct {
  id: string;
  description: string;
  order: number;
  price: number;
}

export interface CataloguePhase {
  name: string;
  description: string;
  products: CatalogueProduct[];
}

export interface CatalogueStack {
  name: string;
  phases: CataloguePhase[];
}

/**
 * `sapQuoteProducts.json` is a verbatim copy of the catalogue the prototype
 * fetched at runtime — product codes and descriptions, byte for byte.
 * Imported rather than fetched so a missing file is a build error rather
 * than a silent fallback to an empty catalogue.
 */
export const PRODUCT_STACKS: ReadonlyArray<CatalogueStack> =
  PRODUCT_CATALOGUE.primaryStacks;

export const PRODUCT_STACK_NAMES = PRODUCT_STACKS.map((s) => s.name);

export const DEFAULT_PRODUCT_STACK = PRODUCT_STACK_NAMES[0];

/** A contingency line is derived from its phase siblings, never typed. */
export function isContingencyCode(code: string): boolean {
  return code.includes('-CONTINGENCY');
}

/**
 * `DI-BIA-SAP-BOBJ-DES-CONTINGENCY` → `DI-BIA-SAP-BOBJ-DES`, the prefix its
 * phase siblings share. Every phase in the catalogue is arranged so that
 * this holds.
 */
export function contingencyPhasePrefix(code: string): string {
  return code.replace('-CONTINGENCY', '');
}

// ─── Project management ───────────────────────────────────────────────

export type PmLevelId = 'admin' | 'coord' | 'silver' | 'gold';

export interface PmLevel {
  id: PmLevelId;
  label: string;
  /** Applied to base (ex-contingency) implementation hours. */
  rate: number;
  deliverables: string[];
}

/**
 * Four tiers, auto-selected from implementation value by
 * `autoSelectedPmLevel()` in `lib/quoting/sapQuoteGenerator.ts`.
 *
 * Deliverables are the prototype's lists verbatim. The SAP BIA LabMat
 * skill carries a second set; six of its Silver and Gold entries restate
 * entries already here ("Change control management." against "Change
 * control support.", "Detailed project plan and roadmap." against
 * "Detailed project plan." plus "High-level project roadmap."), and one is
 * an artefact of that skill refusing to price Gold at all. Merging them
 * would put visible duplication into a client-facing scope document, so
 * these lists stand alone. See AD-14.
 */
export const PM_LEVELS: ReadonlyArray<PmLevel> = [
  {
    id: "admin",
    label: "Project Administration – Bronze L2 (up to £5k)",
    rate: 0.1,
    deliverables: [
      "Project introduction email.",
      "Project update emails.",
      "Change control support.",
      "Project cost monitoring and management.",
      "Project date confirmation.",
      "Formal project completion email."
    ]
  },
  {
    id: "coord",
    label: "Project Coordination – Bronze L1 (up to £10k)",
    rate: 0.125,
    deliverables: [
      "Project kick-off meeting.",
      "Project introduction email.",
      "High-level project initiation document.",
      "Project update emails.",
      "Risk and issue management (RAID log).",
      "Change control support.",
      "Project cost monitoring and management.",
      "High-level project roadmap.",
      "High-level schedule overview.",
      "Project dates confirmation email.",
      "Formal project completion email."
    ]
  },
  {
    id: "silver",
    label: "PRINCE2 Project Management – Silver (up to £50k)",
    rate: 0.15,
    deliverables: [
      "Project kick-off meeting.",
      "Project introduction email.",
      "High-level project initiation document.",
      "Management of 3rd party resources.",
      "Weekly project meetings.",
      "Project update emails.",
      "Risk and issue management (RAID log).",
      "High-level quality management through UAT.",
      "Change control support.",
      "Project cost monitoring and management.",
      "Detailed project plan.",
      "High-level project roadmap.",
      "Formal project completion email.",
      "Customer handover."
    ]
  },
  {
    id: "gold",
    label: "PRINCE2 Project Management – Gold (above £50k)",
    rate: 0.25,
    deliverables: [
      "Project kick-off meeting.",
      "Project introduction email.",
      "Project initiation document.",
      "Management of 3rd party resources.",
      "Weekly project meetings.",
      "Monthly steering committee meetings.",
      "Project update emails.",
      "Risk and issue management (RAID log).",
      "Quality management through UAT.",
      "Change control support.",
      "Project cost monitoring and management.",
      "Detailed project plan.",
      "High-level project roadmap.",
      "Email confirmation of project dates.",
      "Lesson’s learned meeting.",
      "Formal project closure report.",
      "Formal project completion email.",
      "Customer handover."
    ]
  }
];

/**
 * Thresholds for automatic PM tier selection, in pounds of implementation
 * value. Read as: below the first figure is `admin`, and so on.
 *
 * **The basis is contingency-exclusive**, and the comparison is strictly
 * less-than. Both are the prototype's behaviour and both are load-bearing:
 * a quote whose base delivery cost is £4,680 sits in `admin` here, where a
 * contingency-inclusive basis would put it at £5,616 and therefore in
 * `coord`. AD-14 records this and what it costs.
 */
export const PM_THRESHOLDS = [5000, 10000, 50000] as const;

/**
 * Product code per tier. Target-price work uses the `-TM` variant.
 *
 * Used only for the LabMat's product-code column — the percentage comes
 * from `PM_LEVELS`.
 */
export const PM_PRODUCT_CODES: Record<PmLevelId, Record<PricingBasis, string>> = {
  admin: { Fixed: 'DI-BIA-PM-BRONZE2', Target: 'DI-BIA-PM-BRONZE2-TM' },
  coord: { Fixed: 'DI-BIA-PM-BRONZE1', Target: 'DI-BIA-PM-BRONZE1-TM' },
  silver: { Fixed: 'DI-BIA-PM-SILVER', Target: 'DI-BIA-PM-SILVER-TM' },
  gold: { Fixed: 'DI-BIA-PM-GOLD', Target: 'DI-BIA-PM-GOLD-TM' }
};

export const PM_CONTINGENCY_CODE = 'DI-BIA-PM-CONTINGENCY';
export const PM_CONTINGENCY_DESCRIPTION = 'DI BIA PM Contingency';

/** Tier used when nothing else resolves. Matches the prototype's fallback. */
export const DEFAULT_PM_LEVEL: PmLevelId = 'coord';

// ─── Scope ────────────────────────────────────────────────────────────

export type ScopeCategoryId = 'platform' | 'training' | 'other';

export interface ScopeItem {
  id: string;
  /**
   * `{product}` is substituted with the selected stack name at render time.
   * The prototype hardcoded "SAP Business Objects" into the in-place upgrade
   * line, which produced a Crystal Server quote claiming to upgrade
   * BusinessObjects. See AD-14.
   */
  text: string;
  /** Ticked by default for these project types. */
  defaultFor: ProjectType[];
}

export interface ScopeCategory {
  id: ScopeCategoryId;
  label: string;
  items: ScopeItem[];
}

/**
 * In-scope checklist. The three trailing `conv_*` items in "Other" come
 * from the LabMat skill's conversion inclusions and are off by default for
 * both routes — universe conversion is a decision about the engagement,
 * not something either route implies.
 */
export const SCOPE_CATEGORIES: ReadonlyArray<ScopeCategory> = [
  {
    id: "platform",
    label: "SAP Platform Implementation Services",
    items: [
      { id: "prereqs", text: "Pre-installation documentation and checks.", defaultFor: ["install"] },
      { id: "healthcheck", text: "Health check and documentation of critical information required for migration.", defaultFor: [] },
      { id: "download", text: "Downloading the required software ahead of the main scheduled installation.", defaultFor: ["install", "upgrade"] },
      { id: "install_prod", text: "Installation and configuration of new Production server.", defaultFor: ["install"] },
      { id: "install_test", text: "Installation and configuration of a new Test server.", defaultFor: [] },
      { id: "install_dev", text: "Installation and configuration of a new Development server.", defaultFor: [] },
      { id: "upgrade_inplace", text: "In-place upgrade of the {product} server software.", defaultFor: ["upgrade"] },
      { id: "mig_initial", text: "Initial migration from old Production to new Production server.", defaultFor: ["install"] },
      { id: "mig_golive", text: "Go Live re-migration from old Production server to new Production server.", defaultFor: ["install"] },
      { id: "mig_test", text: "Migration from new Production server to new Test server.", defaultFor: [] },
      { id: "mig_dev", text: "Migration from new Production server to new Development server.", defaultFor: [] }
    ]
  },
  {
    id: "training",
    label: "Technical Training Services",
    items: [
      { id: "pbi_1", text: "1-day Power BI Training Course.", defaultFor: [] },
      { id: "pbi_3", text: "3-day Power BI Training Course.", defaultFor: [] },
      { id: "webi_s", text: "1-day WebIntelligence training sessions.", defaultFor: [] },
      { id: "idt_s", text: "1-day Information Design Tool training.", defaultFor: [] }
    ]
  },
  {
    id: "other",
    label: "Other Technical Services",
    items: [
      { id: "uat_s", text: "UAT support.", defaultFor: ["install"] },
      { id: "post_gl", text: "Post go-live support.", defaultFor: ["install"] },
      { id: "ded_upg", text: "Dedicated consultant time following the upgrade for support issues up to the end of the following working day.", defaultFor: ["upgrade"] },
      { id: "conv_universe", text: "Universe conversion for 2025 preparation.", defaultFor: [] },
      { id: "conv_repoint", text: "Repointing reports to new, converted universes.", defaultFor: [] },
      { id: "conv_config", text: "Other system configuration activities associated with conversion and repointing.", defaultFor: [] }
    ]
  }
];

// ─── Dependencies, assumptions, exclusions ────────────────────────────

export interface ContentLibrary {
  dependencies: string[];
  assumptions: string[];
  exclusions: string[];
}

/**
 * Route-keyed defaults, loaded into an editable list when the project type
 * changes. The prototype's text, which on comparison proved to be the same
 * content as the LabMat skill's `scoping_content_sap_bia.json` — both were
 * derived from the same three CheckLists. The one genuine difference was
 * "by client" against "by the client" in an install assumption; the
 * prototype's wording is kept, per the instruction that it wins on
 * conflict. See AD-14.
 */
export const CONTENT_LIBRARY: Record<ProjectType, ContentLibrary> = {
  install: {
    dependencies: [
      "Consulting pre-requisites document being complete.",
      "Consultant access to the new and old environments confirmed in place.",
      "New server(s) commissioned and meeting minimum specifications as laid out in the consulting pre-requisite documentation.",
      "Microsoft Visual C++ Redistributables will be installed on the new environment(s).",
      "Network connectivity in place between the old and new servers for migration purposes."
    ],
    assumptions: [
      "Dependencies not being met will result in a delay to the project commencing.",
      "Consulting pre-requisites document will be followed and confirmed completed in full by client prior to work commencing.",
      "Consultant access to the new and existing environments will be maintained for the duration of the project.",
      "New server(s) will meet the minimum recommended specification for running the platform software.",
      "New server(s) will have all necessary database connectivity drivers in place and correctly named prior to work commencing.",
      "Client will assume responsibility for all User Acceptance Testing tasks, though Codestone will provide consulting support for any issues encountered.",
      "UAT period will be a minimum of 2 weeks and not in excess of 3 months; any UAT support required beyond this period will require additional consulting time or be delivered via existing support agreements.",
      "Any UAT fixes requiring consultant time will be made at the earliest availability of the consultant during the UAT period.",
      "Any cases where UAT is not confirmed as being completed will result in a delay to Go Live activities taking place.",
      "The post Go Live availability of the consultant will be for a maximum of 5 consecutive working days from Go Live being completed.",
      "Upon completion of the post Go Live support, the client's existing support agreement with Codestone will resume.",
      "The client will assume all responsibilities for decommissioning the old server(s).",
      "A working day excludes Saturdays, Sundays and English Bank Holidays and is constrained to between 9am and 5:30pm."
    ],
    exclusions: [
      "Any activities not previously listed as 'In Scope'.",
      "Applying patch fixes or software upgrades to existing platform servers.",
      "Any development of report documents.",
      "Migration of any SAP discontinued content eg Crystal Reports for Enterprise report documents.",
      "Working outside of core office hours (Monday to Friday, 9am to 5:30pm, excluding Bank Holidays), except where agreed for Go Live delivery.",
      "Charges for any expenses incurred for on-site consulting services, which will be charged separately, at cost.",
      "Decommissioning of old environments.",
      "Amending existing schedules to alter destinations or username/passwords.",
      "Correcting any support issues on the old production server, except where this impedes migration activities.",
      "Configuring firewalls and database access/permissions.",
      "Correcting bugs in software, except where a configuration workaround can be implemented.",
      "Any training on new features or software."
    ]
  },
  upgrade: {
    dependencies: [
      "Consultant access to the current server will be in place, with administrative rights.",
      "Server backed up and all windows updates complete prior to the work commencing."
    ],
    assumptions: [
      "Codestone will perform the necessary software downloads ahead of the upgrade taking place.",
      "A catastrophic failure of the upgrade will necessitate a reversion of the server to backups.",
      "Any existing support issues recorded with Codestone do not impact the upgrade.",
      "There are no configuration changes to be made to the server to support the adoption of new features.",
      "The project will be considered complete upon successful system and user acceptance testing by the customer.",
      "User Acceptance testing will immediately follow the completion of the upgrade, up to the end of the next working day."
    ],
    exclusions: [
      "Anything not specifically mentioned as 'in scope'.",
      "On-site travel and expenses.",
      "Installing client tool upgrades on desktop machines, though installer file will be downloaded.",
      "Work outside of Codestone office hours of Monday to Friday, 09:00 to 17:30.",
      "Development of Universes or Reports.",
      "Amendment to or re-running of any report schedules or publications.",
      "Configuring a separate Apache Tomcat installation.",
      "Repair of issues found to not be related to the upgrade.",
      "Replacement of any certificates that support existing https configurations.",
      "Amendments to scheduling destinations and whitelisting.",
      "Resizing of the environment and supporting Apache Tomcat server software."
    ]
  }
};

/**
 * Conversion-specific additions, offered as a one-click insert rather than
 * loaded by default.
 *
 * The skill keeps whole parallel `*_conversion` lists. Substituting a
 * second full list would silently rewrite every bullet the moment a
 * consultant ticked a conversion item; offering only the genuinely
 * conversion-specific lines keeps the edit visible and reversible.
 */
export const CONVERSION_EXTRAS: Record<
  ProjectType,
  { assumptions: string[]; exclusions: string[] }
> = {
  install: {
    assumptions: [
      'Universe conversion and report repointing activities will take place as part of the migration to the new platform.'
    ],
    exclusions: [
      'Any development of new report documents beyond repointing existing reports.'
    ]
  },
  upgrade: {
    assumptions: [
      'Universe conversion and report repointing activities will take place before the upgrade to enable separate UAT of the conversion work to take place.'
    ],
    exclusions: []
  }
};

/** Ids of the scope items that make the conversion extras relevant. */
export const CONVERSION_SCOPE_IDS = ['conv_universe', 'conv_repoint', 'conv_config'];

// ─── CheckList placeholders ───────────────────────────────────────────

/**
 * Tokens in `templates/blank-checklist.docx`. Changing one means changing
 * the template, so they are named here and asserted by test rather than
 * spelled inline in the writer.
 */
export const CHECKLIST_PLACEHOLDERS = {
  ticket: '<<ticket>>',
  customer: '<<customer>>',
  contactName: '<<contact_name>>',
  contactEmail: '<<contact_email>>',
  fixedTarget: '<<fixed_target>>',
  pmRate: '<<pm_rate>>',
  projectBrief: '<<project_brief>>',
  dependencies: '<<dependencies>>',
  assumptions: '<<assumptions>>',
  inScope: '<<in_scope>>',
  outOfScope: '<<out_of_scope>>'
} as const;
