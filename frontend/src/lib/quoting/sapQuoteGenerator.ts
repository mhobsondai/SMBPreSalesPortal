/**
 * SAP Quote Generator — state, costing and scope resolution.
 *
 * Pure functions. No DOM, no network, no React. The page is a rendering of
 * what this module computes, and the document writers take its output.
 *
 * Rebuilt from `bobj_generator.html`. The arithmetic is that prototype's,
 * deliberately, including two decisions that are easy to mistake for bugs —
 * both are recorded in AD-14 and pinned by fixture:
 *
 * 1. The PM tier is chosen from **contingency-exclusive** implementation
 *    value, with strictly-less-than thresholds.
 * 2. Every product in the catalogue is enterable regardless of the selected
 *    project type, so an upgrade quote can carry installation hours. The
 *    prototype had no guard; `routeConflict()` below reports it rather than
 *    preventing it, because the consultant is sometimes right.
 */

import {
  CONTENT_LIBRARY,
  CONTINGENCY_RATE,
  CONVERSION_EXTRAS,
  CONVERSION_SCOPE_IDS,
  DEFAULT_PM_LEVEL,
  DEFAULT_PRODUCT_STACK,
  FALLBACK_DAY_RATE,
  HOURS_PER_DAY,
  PM_LEVELS,
  PM_PRODUCT_CODES,
  PM_THRESHOLDS,
  PRODUCT_STACKS,
  QUOTE_SCHEMA_VERSION,
  SCOPE_CATEGORIES,
  contingencyPhasePrefix,
  isContingencyCode,
  type CataloguePhase,
  type PmLevel,
  type PmLevelId,
  type PricingBasis,
  type ProjectType,
  type ScopeCategoryId
} from '../../config/sapQuoteGeneratorModel';

// ─── State ────────────────────────────────────────────────────────────

/**
 * Hours and activity notes are keyed by **product code**, not by position.
 *
 * The prototype rebuilt a flat `rows` array on every product-type switch,
 * which zeroed everything already entered. Keying by code means switching
 * BusinessObjects → Crystal Server → BusinessObjects leaves the original
 * hours intact, and a catalogue reordering cannot silently move an hour
 * from one product to another. No figure changes: hours recorded against
 * codes outside the selected stack are not in any total.
 */
export interface QuoteState {
  solutionArchitect: string;
  projectDate: string;
  ticket: string;
  client: string;
  contactName: string;
  contactEmail: string;
  productStack: string;
  projectType: ProjectType;
  pricingBasis: PricingBasis;
  hours: Record<string, number>;
  activity: Record<string, string>;
  /** Only consulted when `pmManual` or `pmRateOverride` is set. */
  pmLevel: PmLevelId;
  /** Percentage as typed, e.g. `'12.5'`. Empty means automatic. */
  pmRateOverride: string;
  pmManual: boolean;
  inScope: Record<string, boolean>;
  customScope: Record<ScopeCategoryId, string[]>;
  dependencies: string[];
  assumptions: string[];
  exclusions: string[];
}

/** Scope ticks and content lists for a project type, at their defaults. */
export function defaultsForProjectType(type: ProjectType): Pick<
  QuoteState,
  'inScope' | 'customScope' | 'dependencies' | 'assumptions' | 'exclusions'
> {
  const inScope: Record<string, boolean> = {};
  for (const category of SCOPE_CATEGORIES) {
    for (const item of category.items) {
      inScope[item.id] = item.defaultFor.includes(type);
    }
  }
  const library = CONTENT_LIBRARY[type];
  return {
    inScope,
    customScope: { platform: [], training: [], other: [] },
    dependencies: [...library.dependencies],
    assumptions: [...library.assumptions],
    exclusions: [...library.exclusions]
  };
}

export function createBlankQuote(today: string): QuoteState {
  return {
    solutionArchitect: '',
    projectDate: today,
    ticket: '',
    client: '',
    contactName: '',
    contactEmail: '',
    productStack: DEFAULT_PRODUCT_STACK,
    projectType: 'install',
    pricingBasis: 'Fixed',
    hours: {},
    activity: {},
    pmLevel: DEFAULT_PM_LEVEL,
    pmRateOverride: '',
    pmManual: false,
    ...defaultsForProjectType('install')
  };
}

/**
 * Switching project type resets the scope and content lists to that type's
 * defaults, discarding edits. The prototype did the same; the page confirms
 * first, because a rewritten exclusions list is not obviously recoverable.
 */
export function withProjectType(state: QuoteState, type: ProjectType): QuoteState {
  return {
    ...state,
    projectType: type,
    pmManual: false,
    ...defaultsForProjectType(type)
  };
}

export function withProductStack(state: QuoteState, stack: string): QuoteState {
  return { ...state, productStack: stack, pmManual: false };
}

// ─── Lines and phases ─────────────────────────────────────────────────

export interface QuoteLine {
  code: string;
  description: string;
  /** `''` unless the consultant typed a note. Contingency lines never have one. */
  activity: string;
  dayRate: number;
  isContingency: boolean;
  hours: number;
  days: number;
  value: number;
}

export interface QuotePhase {
  name: string;
  description: string;
  /** Every line in the phase, including zero-hour and contingency lines. */
  lines: QuoteLine[];
  hours: number;
  days: number;
  value: number;
  /**
   * Total value ÷ total days. Identical to the line rate while every product
   * costs the same, but a blended figure is correct if one ever does not.
   */
  dayRate: number;
}

function phasesOf(stackName: string): ReadonlyArray<CataloguePhase> {
  return PRODUCT_STACKS.find((s) => s.name === stackName)?.phases ?? [];
}

/** Blank, negative and non-finite hours all coerce to 0, per AD-09. */
export function normaliseHours(raw: string | number | undefined): number {
  const value = typeof raw === 'number' ? raw : Number.parseFloat((raw ?? '').trim());
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The costed phase structure for the current state.
 *
 * Contingency is derived here and never stored: each contingency product
 * takes the configured rate against the non-contingency hours of every
 * product sharing its phase prefix.
 */
export function buildPhases(state: QuoteState): QuotePhase[] {
  const rate = CONTINGENCY_RATE[state.pricingBasis];

  const typed = new Map<string, number>();
  for (const phase of phasesOf(state.productStack)) {
    for (const product of phase.products) {
      if (isContingencyCode(product.id)) continue;
      typed.set(product.id, normaliseHours(state.hours[product.id]));
    }
  }

  const out: QuotePhase[] = [];
  for (const phase of phasesOf(state.productStack)) {
    const lines: QuoteLine[] = phase.products.map((product) => {
      const contingency = isContingencyCode(product.id);
      let hours: number;
      if (contingency) {
        const prefix = contingencyPhasePrefix(product.id);
        let siblings = 0;
        for (const [code, value] of typed) {
          if (code.startsWith(prefix)) siblings += value;
        }
        hours = siblings * rate;
      } else {
        hours = typed.get(product.id) ?? 0;
      }
      const dayRate = product.price || FALLBACK_DAY_RATE;
      const days = hours / HOURS_PER_DAY;
      return {
        code: product.id,
        description: product.description,
        activity: contingency ? '' : (state.activity[product.id] ?? ''),
        dayRate,
        isContingency: contingency,
        hours,
        days,
        value: days * dayRate
      };
    });

    const hours = lines.reduce((n, l) => n + l.hours, 0);
    const value = lines.reduce((n, l) => n + l.value, 0);
    const days = hours / HOURS_PER_DAY;
    out.push({
      name: phase.name,
      description: phase.description,
      lines,
      hours,
      days,
      value,
      dayRate: days > 0 ? value / days : (lines[0]?.dayRate ?? FALLBACK_DAY_RATE)
    });
  }
  return out;
}

/** Phases with at least one costed line, and only those lines. Quote order. */
export function costedPhases(phases: QuotePhase[]): QuotePhase[] {
  return phases
    .map((phase) => ({ ...phase, lines: phase.lines.filter((l) => l.hours > 0) }))
    .filter((phase) => phase.lines.length > 0);
}

// ─── Project management ───────────────────────────────────────────────

/**
 * Tier from implementation value.
 *
 * Note the basis and the operator: contingency-**exclusive** value, and
 * strictly less-than. Carried over from the prototype deliberately.
 */
export function autoSelectedPmLevel(baseValue: number): PmLevelId {
  const [bronze2, bronze1, silver] = PM_THRESHOLDS;
  if (baseValue < bronze2) return 'admin';
  if (baseValue < bronze1) return 'coord';
  if (baseValue < silver) return 'silver';
  return 'gold';
}

/** A manual pick or a rate override pins the tier; otherwise it follows value. */
export function resolvePmLevel(state: QuoteState, baseValue: number): PmLevelId {
  if (state.pmManual || state.pmRateOverride.trim() !== '') return state.pmLevel;
  return autoSelectedPmLevel(baseValue);
}

export function pmLevelOf(id: PmLevelId): PmLevel {
  return PM_LEVELS.find((l) => l.id === id) ?? PM_LEVELS[1];
}

/**
 * The override, or the tier's rate.
 *
 * A non-numeric override falls back to the tier rate rather than
 * propagating `NaN` through every total — the prototype would have blanked
 * the whole quote on one stray keystroke, which AD-09 already rejected for
 * the Fabric calculator.
 */
export function resolvePmRate(state: QuoteState, level: PmLevelId): number {
  const raw = state.pmRateOverride.trim();
  if (raw !== '') {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed / 100;
  }
  return pmLevelOf(level).rate;
}

// ─── Totals ───────────────────────────────────────────────────────────

export interface QuoteTotals {
  phases: QuotePhase[];
  /** Day rate carried by the first product in the stack. */
  dayRate: number;
  /** Includes contingency lines. */
  implementationHours: number;
  implementationDays: number;
  implementationValue: number;
  /** Excludes contingency. The basis for both PM hours and PM tier. */
  baseHours: number;
  baseValue: number;
  pmLevel: PmLevelId;
  pmLabel: string;
  pmProductCode: string;
  pmRate: number;
  pmHours: number;
  pmDays: number;
  pmValue: number;
  contingencyRate: number;
  pmContingencyHours: number;
  pmContingencyDays: number;
  pmContingencyValue: number;
  grandHours: number;
  grandDays: number;
  grandValue: number;
  isEmpty: boolean;
}

export function computeTotals(state: QuoteState): QuoteTotals {
  const phases = buildPhases(state);
  const allLines = phases.flatMap((p) => p.lines);

  const dayRate =
    phasesOf(state.productStack)[0]?.products[0]?.price || FALLBACK_DAY_RATE;

  const implementationHours = allLines.reduce((n, l) => n + l.hours, 0);
  const baseHours = allLines
    .filter((l) => !l.isContingency)
    .reduce((n, l) => n + l.hours, 0);

  const implementationDays = implementationHours / HOURS_PER_DAY;
  const baseValue = (baseHours / HOURS_PER_DAY) * dayRate;

  const pmLevel = resolvePmLevel(state, baseValue);
  const pmRate = resolvePmRate(state, pmLevel);
  const pmHours = baseHours * pmRate;
  const pmDays = pmHours / HOURS_PER_DAY;

  const contingencyRate = CONTINGENCY_RATE[state.pricingBasis];
  const pmContingencyHours = pmHours * contingencyRate;
  const pmContingencyDays = pmContingencyHours / HOURS_PER_DAY;

  const grandHours = implementationHours + pmHours + pmContingencyHours;

  return {
    phases,
    dayRate,
    implementationHours,
    implementationDays,
    implementationValue: implementationDays * dayRate,
    baseHours,
    baseValue,
    pmLevel,
    pmLabel: pmLevelOf(pmLevel).label,
    pmProductCode: PM_PRODUCT_CODES[pmLevel][state.pricingBasis],
    pmRate,
    pmHours,
    pmDays,
    pmValue: pmDays * dayRate,
    contingencyRate,
    pmContingencyHours,
    pmContingencyDays,
    pmContingencyValue: pmContingencyDays * dayRate,
    grandHours,
    grandDays: grandHours / HOURS_PER_DAY,
    grandValue: (grandHours / HOURS_PER_DAY) * dayRate,
    isEmpty: baseHours === 0
  };
}

// ─── Validation ───────────────────────────────────────────────────────

export interface QuoteWarning {
  id: string;
  text: string;
}

/**
 * A quote is either an in-place upgrade or an install plus migration, not
 * both. The prototype offered every build product for entry with nothing to
 * catch the combination.
 *
 * Reported rather than blocked: the consultant may be quoting something
 * genuinely unusual, and a tool that silently refuses a figure is worse
 * than one that asks about it.
 */
export function routeConflict(phases: QuotePhase[]): string[] {
  const costed = phases.flatMap((p) => p.lines).filter((l) => l.hours > 0);
  const upgrade = costed.filter((l) => l.code.includes('-BLD-UPGR-'));
  const install = costed.filter(
    (l) => l.code.includes('-BLD-MIGR-') || l.code.endsWith('-BLD-MIGRATION')
  );
  if (upgrade.length === 0 || install.length === 0) return [];
  return [...upgrade, ...install].map((l) => l.code);
}

export function warnings(state: QuoteState, totals: QuoteTotals): QuoteWarning[] {
  const out: QuoteWarning[] = [];

  const conflict = routeConflict(totals.phases);
  if (conflict.length > 0) {
    out.push({
      id: 'route-conflict',
      text: `Hours are entered against both in-place upgrade and installation products (${conflict.join(', ')}). A quote should be one route or the other — check this is intended before issuing it.`
    });
  }

  const mismatch =
    state.projectType === 'upgrade'
      ? totals.phases
          .flatMap((p) => p.lines)
          .filter((l) => l.hours > 0 && (l.code.includes('-BLD-MIGR-') || l.code.endsWith('-BLD-MIGRATION')))
      : totals.phases
          .flatMap((p) => p.lines)
          .filter((l) => l.hours > 0 && l.code.includes('-BLD-UPGR-'));
  if (conflict.length === 0 && mismatch.length > 0) {
    out.push({
      id: 'route-mismatch',
      text: `Project type is set to ${state.projectType === 'upgrade' ? 'In-Place Upgrade' : 'New Installation'}, but the costed products are for the other route. The scope and exclusions come from the project type, so they will not match the quote.`
    });
  }

  if (totals.pmLevel === 'gold') {
    out.push({
      id: 'pm-gold',
      text: `Implementation value is £${Math.round(totals.baseValue).toLocaleString('en-GB')}, which selects Gold at ${(totals.pmRate * 100).toFixed(1)}%. Gold engagements are usually reviewed before issue rather than priced from the tier alone.`
    });
  }

  const conversionSelected = CONVERSION_SCOPE_IDS.some((id) => state.inScope[id]);
  const extras = CONVERSION_EXTRAS[state.projectType];
  const missing = [
    ...extras.assumptions.filter((t) => !state.assumptions.includes(t)),
    ...extras.exclusions.filter((t) => !state.exclusions.includes(t))
  ];
  if (conversionSelected && missing.length > 0) {
    out.push({
      id: 'conversion-extras',
      text: `Universe conversion is in scope but the conversion assumptions and exclusions have not been added. Use "Add conversion clauses" on the Dependencies & Assumptions step.`
    });
  }

  /*
   * Caught by rendering a CheckList and reading it (AD-13's discipline): the
   * quote costed 3.75h of Tomcat upgrade while the exclusions still said
   * "Configuring a separate Apache Tomcat installation." The prototype had
   * no rule connecting the two, so the contradiction went into the filed
   * document. Reported rather than silently removed — deleting a line from
   * an exclusions list on the tool's own initiative is exactly the kind of
   * invisible edit that gets quoted back at you.
   */
  const tomcatCosted = totals.phases
    .flatMap((p) => p.lines)
    .some((l) => l.hours > 0 && l.code.includes('-TOMCAT'));
  const tomcatExcluded = state.exclusions.filter((t) =>
    /separate Apache Tomcat/i.test(t)
  );
  if (tomcatCosted && tomcatExcluded.length > 0) {
    out.push({
      id: 'tomcat-contradiction',
      text: `Tomcat work is costed but the exclusions still rule it out (“${tomcatExcluded[0]}”). Remove that exclusion, or move the Tomcat hours, before issuing the quote.`
    });
  }

  if (state.pricingBasis === 'Target' && totals.contingencyRate === 0 && !totals.isEmpty) {
    out.push({
      id: 'target-no-contingency',
      text: 'Target price carries no contingency, so the quoted figure is the base estimate. Time above it is billable but not quoted.'
    });
  }

  return out;
}

// ─── Scope resolution ─────────────────────────────────────────────────

export interface ResolvedScopeCategory {
  id: ScopeCategoryId;
  label: string;
  items: string[];
}

/** `{product}` → the selected stack name. */
export function fillProduct(text: string, productStack: string): string {
  return text.replace(/\{product\}/g, productStack);
}

/**
 * Ticked items plus custom additions, per category, with empty categories
 * dropped. This is what goes into the CheckList's Inclusions section.
 */
export function resolveScope(state: QuoteState): ResolvedScopeCategory[] {
  const out: ResolvedScopeCategory[] = [];
  for (const category of SCOPE_CATEGORIES) {
    const items = [
      ...category.items
        .filter((item) => state.inScope[item.id])
        .map((item) => fillProduct(item.text, state.productStack)),
      ...(state.customScope[category.id] ?? [])
        .map((t) => t.trim())
        .filter((t) => t !== '')
    ];
    if (items.length > 0) {
      out.push({ id: category.id, label: category.label, items });
    }
  }
  return out;
}

/** Adds the conversion clauses for the current route, without duplicating. */
export function withConversionExtras(state: QuoteState): QuoteState {
  const extras = CONVERSION_EXTRAS[state.projectType];
  const add = (list: string[], items: string[]) => [
    ...list,
    ...items.filter((t) => !list.includes(t))
  ];
  return {
    ...state,
    assumptions: add(state.assumptions, extras.assumptions),
    exclusions: add(state.exclusions, extras.exclusions)
  };
}

// ─── Formatting ───────────────────────────────────────────────────────

/** `6178` — whole pounds with thousands separators, as the prototype showed. */
export function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** `7.5` — one decimal place, for hours and days. */
export function formatHours(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '0.0';
}

export function formatPercent(rate: number): string {
  const pct = rate * 100;
  return `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

// ─── Output filename ──────────────────────────────────────────────────

/** `BOBJ_Install_2437170_LabMat.xlsx` */
export function outputFilename(
  state: QuoteState,
  kind: 'LabMat' | 'CheckList',
  extension: string
): string {
  const prefix = state.productStack.includes('Crystal') ? 'CRY' : 'BOBJ';
  const route = state.projectType === 'install' ? 'Install' : 'Upgrade';
  const ticket = state.ticket.trim().replace(/[^a-zA-Z0-9-]+/g, '');
  return `${prefix}_${route}${ticket ? `_${ticket}` : ''}_${kind}.${extension}`;
}

// ─── Copy-ready summary ───────────────────────────────────────────────

/** Plain text for pasting into an email or a ticket. */
export function summaryLines(state: QuoteState, totals: QuoteTotals): string[] {
  const lines: string[] = [];
  lines.push('SAP BI PLATFORM — QUOTE SUMMARY');
  lines.push(state.client.trim() || 'Unnamed client');
  lines.push('');
  lines.push(`Product:      ${state.productStack}`);
  lines.push(
    `Route:        ${state.projectType === 'install' ? 'New Installation' : 'In-Place Upgrade'} (${state.pricingBasis} price)`
  );
  if (state.ticket.trim()) lines.push(`Ticket:       ${state.ticket.trim()}`);
  if (state.solutionArchitect.trim()) {
    lines.push(`Architect:    ${state.solutionArchitect.trim()}`);
  }

  for (const phase of costedPhases(totals.phases)) {
    lines.push('');
    lines.push(phase.name.toUpperCase());
    for (const line of phase.lines) {
      const note = line.activity.trim() ? ` — ${line.activity.trim()}` : '';
      lines.push(
        `  ${line.description}${line.isContingency ? ' (auto)' : ''}: ${formatHours(line.hours)}h · £${formatMoney(line.value)}${note}`
      );
    }
    lines.push(
      `  ${phase.name} subtotal: ${formatHours(phase.hours)}h · £${formatMoney(phase.value)}`
    );
  }

  lines.push('');
  lines.push('─'.repeat(44));
  lines.push(
    `Implementation: ${formatHours(totals.implementationHours)}h · ${formatHours(totals.implementationDays)}d · £${formatMoney(totals.implementationValue)}`
  );
  lines.push(
    `${totals.pmLabel} (${formatPercent(totals.pmRate)}): ${formatHours(totals.pmHours)}h · £${formatMoney(totals.pmValue)}`
  );
  if (totals.pmContingencyHours > 0) {
    lines.push(
      `PM contingency (${formatPercent(totals.contingencyRate)}): ${formatHours(totals.pmContingencyHours)}h · £${formatMoney(totals.pmContingencyValue)}`
    );
  }
  lines.push(
    `GRAND TOTAL: ${formatHours(totals.grandHours)}h · ${formatHours(totals.grandDays)}d · £${formatMoney(totals.grandValue)}`
  );

  const notes = warnings(state, totals);
  if (notes.length > 0) {
    lines.push('');
    lines.push('POINTS TO CHECK');
    for (const note of notes) lines.push(`  • ${note.text}`);
  }

  return lines;
}

// ─── Persistence ──────────────────────────────────────────────────────

/**
 * Version-scoped, so a schema change starts clean rather than misreading a
 * half-finished quote.
 *
 * What is stored includes a client name and, once the assessment handoff
 * lands, two contact details — so the page carries a notice saying so and a
 * Clear control, on the AD-11 pattern. Nothing reaches a server.
 */
export const STORAGE_KEY = `codestone.sap-quote-generator.v${QUOTE_SCHEMA_VERSION}`;

/**
 * Restore a saved quote, refusing anything not fully recognised rather than
 * attempting a repair. A partially-restored quote is worse than an empty
 * one: the consultant would not know which hours survived.
 */
export function deserialise(raw: string | null): QuoteState | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return undefined;
    const c = parsed as Partial<QuoteState>;
    if (typeof c.productStack !== 'string') return undefined;
    if (!PRODUCT_STACKS.some((s) => s.name === c.productStack)) return undefined;
    if (c.projectType !== 'install' && c.projectType !== 'upgrade') return undefined;
    if (c.pricingBasis !== 'Fixed' && c.pricingBasis !== 'Target') return undefined;
    if (!c.hours || typeof c.hours !== 'object') return undefined;
    if (!c.activity || typeof c.activity !== 'object') return undefined;
    if (!c.inScope || typeof c.inScope !== 'object') return undefined;
    if (!c.customScope || typeof c.customScope !== 'object') return undefined;
    for (const key of ['dependencies', 'assumptions', 'exclusions'] as const) {
      if (!Array.isArray(c[key])) return undefined;
      if ((c[key] as unknown[]).some((v) => typeof v !== 'string')) return undefined;
    }
    if (!PM_LEVELS.some((l) => l.id === c.pmLevel)) return undefined;
    return c as QuoteState;
  } catch {
    return undefined;
  }
}

export function serialise(state: QuoteState): string {
  return JSON.stringify(state);
}
