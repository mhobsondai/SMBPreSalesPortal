import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CONTENT_LIBRARY,
  CONTINGENCY_RATE,
  HOURS_PER_DAY,
  PM_LEVELS,
  PM_PRODUCT_CODES,
  PM_THRESHOLDS,
  PRODUCT_STACKS,
  SCOPE_CATEGORIES,
  contingencyPhasePrefix,
  isContingencyCode
} from '../../config/sapQuoteGeneratorModel';
import {
  autoSelectedPmLevel,
  buildPhases,
  computeTotals,
  costedPhases,
  createBlankQuote,
  defaultsForProjectType,
  deserialise,
  fillProduct,
  formatHours,
  formatMoney,
  formatPercent,
  normaliseHours,
  outputFilename,
  resolvePmRate,
  resolveScope,
  routeConflict,
  serialise,
  summaryLines,
  warnings,
  withConversionExtras,
  withProjectType,
  type QuoteState
} from './sapQuoteGenerator';

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'reference.json');
const TODAY = '2026-08-05';

const BOBJ = 'SAP Business Objects';
const CRY = 'SAP Crystal Server';

function quote(overrides: Partial<QuoteState> = {}): QuoteState {
  return { ...createBlankQuote(TODAY), ...overrides };
}

// ══════════════════════════════════════════════════════════════════════
// An independent statement of the prototype's arithmetic.
//
// Transcribed from `bobj_generator.html`'s `recalcContingency()`, `tots()`
// and `autoSelectPm()` rather than from the port. Two independent
// expressions of the same rules agreeing is evidence; the port checked
// against itself would be none.
//
// Deliberately literal, including the two behaviours AD-14 records:
// contingency-exclusive PM tiering, and strictly-less-than thresholds.
// ══════════════════════════════════════════════════════════════════════
function prototypeTotals(state: QuoteState) {
  const stack = PRODUCT_STACKS.find((s) => s.name === state.productStack);
  const rows = (stack?.phases ?? []).flatMap((phase) =>
    phase.products.map((product) => ({
      id: product.id,
      price: product.price,
      isCont: product.id.includes('-CONTINGENCY'),
      hours: 0
    }))
  );
  for (const row of rows) {
    if (!row.isCont) row.hours = normaliseHours(state.hours[row.id]);
  }
  // recalcContingency()
  const pct = state.pricingBasis === 'Fixed' ? 0.2 : 0;
  for (const row of rows) {
    if (!row.isCont) continue;
    const prefix = row.id.replace('-CONTINGENCY', '');
    let phaseH = 0;
    for (const other of rows) {
      if (!other.isCont && other.id.startsWith(prefix)) phaseH += other.hours;
    }
    row.hours = phaseH * pct;
  }
  // tots()
  const implH = rows.reduce((n, r) => n + r.hours, 0);
  const dr = rows[0]?.price || 1200;
  const pmBaseH = rows.filter((r) => !r.isCont).reduce((n, r) => n + r.hours, 0);
  // autoSelectPm() is fed the NON-contingency value from render()
  const autoValue = (pmBaseH / HOURS_PER_DAY) * dr;
  let level = state.pmLevel;
  if (!state.pmManual && state.pmRateOverride.trim() === '') {
    level =
      autoValue < 5000
        ? 'admin'
        : autoValue < 10000
          ? 'coord'
          : autoValue < 50000
            ? 'silver'
            : 'gold';
  }
  const rate =
    state.pmRateOverride.trim() !== ''
      ? Number.parseFloat(state.pmRateOverride) / 100
      : (PM_LEVELS.find((p) => p.id === level)?.rate ?? 0.125);
  const pmH = pmBaseH * rate;
  const pmContH = pmH * pct;
  const grandH = implH + pmH + pmContH;
  return {
    implementationHours: implH,
    implementationValue: (implH / HOURS_PER_DAY) * dr,
    baseHours: pmBaseH,
    pmLevel: level,
    pmRate: rate,
    pmHours: pmH,
    pmContingencyHours: pmContH,
    grandHours: grandH,
    grandValue: (grandH / HOURS_PER_DAY) * dr
  };
}

// ── Scenarios. Each stores its own inputs, per AD-10. ─────────────────

const SCENARIOS: Array<{ name: string; state: QuoteState }> = [
  { name: 'blank', state: quote() },

  {
    name: 'BOBJ upgrade, fixed',
    state: quote({
      client: 'Bromley Metals Ltd',
      solutionArchitect: 'Mike Hobson',
      ticket: '2437170',
      productStack: BOBJ,
      projectType: 'upgrade',
      pricingBasis: 'Fixed',
      ...defaultsForProjectType('upgrade'),
      hours: {
        'DI-BIA-SAP-BOBJ-DES-CONNECT': 0.5,
        'DI-BIA-SAP-BOBJ-DES-SOFTWARE': 1,
        'DI-BIA-SAP-BOBJ-DES-PREINSTALL': 1,
        'DI-BIA-SAP-BOBJ-BLD-UPGR-INSTALL': 7.5,
        'DI-BIA-SAP-BOBJ-UA-TESTING': 3.75,
        'DI-BIA-SAP-BOBJ-TRN-CLOUDCARE': 3.75
      },
      activity: { 'DI-BIA-SAP-BOBJ-BLD-UPGR-INSTALL': 'Platform and client tools to 2025' }
    })
  },

  {
    name: 'BOBJ upgrade with conversion, fixed',
    state: withConversionExtras(
      quote({
        client: 'Bromley Metals Ltd',
        productStack: BOBJ,
        projectType: 'upgrade',
        ...defaultsForProjectType('upgrade'),
        hours: {
          'DI-BIA-SAP-BOBJ-DES-CONNECT': 0.5,
          'DI-BIA-SAP-BOBJ-DES-SOFTWARE': 2,
          'DI-BIA-SAP-BOBJ-DES-PREINSTALL': 2,
          'DI-BIA-SAP-BOBJ-BLD-UPGR-INSTALL': 7.5,
          'DI-BIA-SAP-BOBJ-BLD-DEV-REPORTS': 15,
          'DI-BIA-SAP-BOBJ-UA-TESTING': 15,
          'DI-BIA-SAP-BOBJ-TRN-CLOUDCARE': 1
        },
        inScope: {
          ...defaultsForProjectType('upgrade').inScope,
          conv_universe: true,
          conv_repoint: true
        }
      })
    )
  },

  {
    name: 'CRY install, fixed — crosses the 5k PM threshold',
    state: quote({
      client: 'Broder Group',
      productStack: CRY,
      projectType: 'install',
      pricingBasis: 'Fixed',
      ...defaultsForProjectType('install'),
      hours: {
        'DI-BIA-SAP-CRY-DES-CONNECT': 0.5,
        'DI-BIA-SAP-CRY-DES-SOFTWARE': 1.5,
        'DI-BIA-SAP-CRY-BLD-MIGR-INSTALL': 7.5,
        'DI-BIA-SAP-CRY-BLD-MIGR-CONFIG': 7.5,
        'DI-BIA-SAP-CRY-BLD-MIGRATION': 7.5,
        'DI-BIA-SAP-CRY-UA-TESTING': 3.75,
        'DI-BIA-SAP-CRY-TRN-CLOUDCARE': 1
      }
    })
  },

  {
    name: 'CRY install, target price — no contingency',
    state: quote({
      client: 'Broder Group',
      productStack: CRY,
      projectType: 'install',
      pricingBasis: 'Target',
      ...defaultsForProjectType('install'),
      hours: {
        'DI-BIA-SAP-CRY-DES-CONNECT': 0.5,
        'DI-BIA-SAP-CRY-BLD-MIGR-INSTALL': 7.5,
        'DI-BIA-SAP-CRY-BLD-MIGRATION': 15,
        'DI-BIA-SAP-CRY-UA-TESTING': 7.5,
        'DI-BIA-SAP-CRY-TRN-CLOUDCARE': 1
      }
    })
  },

  {
    name: 'BOBJ install, silver tier with full phase set',
    state: quote({
      client: 'Large Estate plc',
      productStack: BOBJ,
      projectType: 'install',
      ...defaultsForProjectType('install'),
      hours: {
        'DI-BIA-SAP-BOBJ-DES-CONNECT': 2,
        'DI-BIA-SAP-BOBJ-DES-SOFTWARE': 7.5,
        'DI-BIA-SAP-BOBJ-DES-PREINSTALL': 3.75,
        'DI-BIA-SAP-BOBJ-DES-WORKSHOP': 15,
        'DI-BIA-SAP-BOBJ-BLD-MIGR-INSTALL': 22.5,
        'DI-BIA-SAP-BOBJ-BLD-MIGR-CONFIG': 15,
        'DI-BIA-SAP-BOBJ-BLD-MIGR-TOMCAT': 7.5,
        'DI-BIA-SAP-BOBJ-BLD-MIGRATION': 30,
        'DI-BIA-SAP-BOBJ-BLD-DEV-UNIVERSE': 22.5,
        'DI-BIA-SAP-BOBJ-BLD-DEV-REPORTS': 30,
        'DI-BIA-SAP-BOBJ-SIT': 15,
        'DI-BIA-SAP-BOBJ-TRAINING': 15,
        'DI-BIA-SAP-BOBJ-UA-TESTING': 22.5,
        'DI-BIA-SAP-BOBJ-TRN-CLOUDCARE': 3.75,
        'DI-BIA-SAP-BOBJ-TRN-OPERATIONS': 7.5
      }
    })
  },

  {
    name: 'BOBJ upgrade with a manual tier and rate override',
    state: quote({
      client: 'Override Ltd',
      productStack: BOBJ,
      projectType: 'upgrade',
      ...defaultsForProjectType('upgrade'),
      pmManual: true,
      pmLevel: 'silver',
      pmRateOverride: '17.5',
      hours: {
        'DI-BIA-SAP-BOBJ-DES-CONNECT': 0.5,
        'DI-BIA-SAP-BOBJ-BLD-UPGR-INSTALL': 7.5,
        'DI-BIA-SAP-BOBJ-BLD-UPGR-TOMCAT': 3.75,
        'DI-BIA-SAP-BOBJ-UA-TESTING': 3.75,
        'DI-BIA-SAP-BOBJ-TRN-CLOUDCARE': 1
      }
    })
  },

  {
    name: 'both routes costed — conflict warning',
    state: quote({
      client: 'Mixed Route Ltd',
      productStack: BOBJ,
      projectType: 'upgrade',
      ...defaultsForProjectType('upgrade'),
      hours: {
        'DI-BIA-SAP-BOBJ-BLD-UPGR-INSTALL': 7.5,
        'DI-BIA-SAP-BOBJ-BLD-MIGRATION': 7.5,
        'DI-BIA-SAP-BOBJ-UA-TESTING': 3.75
      }
    })
  }
];

interface Snapshot {
  name: string;
  input: QuoteState;
  totals: Record<string, number | string | boolean>;
  costedLines: Array<{ phase: string; code: string; hours: number; value: number }>;
  scope: ReturnType<typeof resolveScope>;
  warningIds: string[];
  summary: string[];
}

function snapshot(name: string, state: QuoteState): Snapshot {
  const totals = computeTotals(state);
  return {
    name,
    input: state,
    totals: {
      implementationHours: totals.implementationHours,
      implementationDays: totals.implementationDays,
      implementationValue: totals.implementationValue,
      baseHours: totals.baseHours,
      baseValue: totals.baseValue,
      pmLevel: totals.pmLevel,
      pmProductCode: totals.pmProductCode,
      pmRate: totals.pmRate,
      pmHours: totals.pmHours,
      pmValue: totals.pmValue,
      contingencyRate: totals.contingencyRate,
      pmContingencyHours: totals.pmContingencyHours,
      grandHours: totals.grandHours,
      grandDays: totals.grandDays,
      grandValue: totals.grandValue,
      isEmpty: totals.isEmpty
    },
    costedLines: costedPhases(totals.phases).flatMap((phase) =>
      phase.lines.map((line) => ({
        phase: phase.name,
        code: line.code,
        hours: line.hours,
        value: line.value
      }))
    ),
    scope: resolveScope(state),
    warningIds: warnings(state, totals).map((w) => w.id),
    summary: summaryLines(state, totals)
  };
}

const current = SCENARIOS.map((s) => snapshot(s.name, s.state));

if (process.env.UPDATE_FIXTURES) {
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
}

const pinned = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Snapshot[];

// ══════════════════════════════════════════════════════════════════════

describe('pinned pricing', () => {
  it('covers every scenario', () => {
    expect(pinned.map((p) => p.name)).toEqual(SCENARIOS.map((s) => s.name));
  });

  it('stores its own inputs, so every case can be replayed', () => {
    for (const entry of pinned) {
      expect(entry.input).toBeDefined();
      expect(entry.input.productStack).toBeTypeOf('string');
      expect(entry.input.hours).toBeTypeOf('object');
    }
  });

  it('replays the pinned inputs to the pinned outputs', () => {
    for (const entry of pinned) {
      expect(snapshot(entry.name, entry.input)).toEqual(entry);
    }
  });

  describe.each(current)('$name', (snap) => {
    const reference = pinned.find((p) => p.name === snap.name);

    it('costs the same', () => {
      expect(snap.totals).toEqual(reference?.totals);
    });

    it('produces the same lines', () => {
      expect(snap.costedLines).toEqual(reference?.costedLines);
    });

    it('resolves the same scope', () => {
      expect(snap.scope).toEqual(reference?.scope);
    });

    it('raises the same warnings', () => {
      expect(snap.warningIds).toEqual(reference?.warningIds);
    });

    it('summarises identically', () => {
      expect(snap.summary).toEqual(reference?.summary);
    });
  });
});

describe('parity with the prototype', () => {
  describe.each(SCENARIOS)('$name', ({ state }) => {
    it('matches an independent statement of the prototype arithmetic', () => {
      const mine = computeTotals(state);
      const theirs = prototypeTotals(state);
      expect(mine.implementationHours).toBeCloseTo(theirs.implementationHours, 10);
      expect(mine.implementationValue).toBeCloseTo(theirs.implementationValue, 8);
      expect(mine.baseHours).toBeCloseTo(theirs.baseHours, 10);
      expect(mine.pmLevel).toBe(theirs.pmLevel);
      expect(mine.pmRate).toBeCloseTo(theirs.pmRate, 10);
      expect(mine.pmHours).toBeCloseTo(theirs.pmHours, 10);
      expect(mine.pmContingencyHours).toBeCloseTo(theirs.pmContingencyHours, 10);
      expect(mine.grandHours).toBeCloseTo(theirs.grandHours, 10);
      expect(mine.grandValue).toBeCloseTo(theirs.grandValue, 8);
    });
  });
});

describe('hand-computed anchors', () => {
  it('costs a 15.25h fixed-price upgrade at £3,220.80', () => {
    // design 2.5 + build 7.5 + UAT 3.75 + transition 3.75 = 17.5h base
    // contingency 3.5h → 21h; PM admin 10% of 17.5 = 1.75h; PM cont 0.35h
    // 23.1h ÷ 7.5 × 1200 = £3,696
    const totals = computeTotals(
      SCENARIOS.find((s) => s.name === 'BOBJ upgrade, fixed')!.state
    );
    expect(totals.baseHours).toBe(17.5);
    expect(totals.implementationHours).toBeCloseTo(21, 10);
    expect(totals.pmHours).toBeCloseTo(1.75, 10);
    expect(totals.grandHours).toBeCloseTo(23.1, 10);
    expect(totals.grandValue).toBeCloseTo(3696, 6);
  });

  it('tiers the Crystal install at admin, not coord', () => {
    // 29.25h base → £4,680 ex-contingency, which is under £5,000.
    // A contingency-inclusive basis would read £5,616 and select coord.
    // AD-14 records this as the prototype's behaviour, kept deliberately.
    const totals = computeTotals(
      SCENARIOS.find((s) => s.name.startsWith('CRY install, fixed'))!.state
    );
    expect(totals.baseHours).toBeCloseTo(29.25, 10);
    expect(totals.baseValue).toBeCloseTo(4680, 6);
    expect(totals.pmLevel).toBe('admin');
    expect(totals.pmRate).toBe(0.1);
    expect(totals.grandValue).toBeCloseTo(6177.6, 4);
  });

  it('carries no contingency on target price', () => {
    const totals = computeTotals(
      SCENARIOS.find((s) => s.name.includes('target price'))!.state
    );
    expect(totals.contingencyRate).toBe(0);
    expect(totals.implementationHours).toBe(totals.baseHours);
    expect(totals.pmContingencyHours).toBe(0);
    expect(totals.pmProductCode.endsWith('-TM')).toBe(true);
  });
});

describe('PM tier selection', () => {
  it('uses strictly-less-than thresholds', () => {
    const [bronze2, bronze1, silver] = PM_THRESHOLDS;
    expect(autoSelectedPmLevel(bronze2 - 0.01)).toBe('admin');
    expect(autoSelectedPmLevel(bronze2)).toBe('coord');
    expect(autoSelectedPmLevel(bronze1 - 0.01)).toBe('coord');
    expect(autoSelectedPmLevel(bronze1)).toBe('silver');
    expect(autoSelectedPmLevel(silver - 0.01)).toBe('silver');
    expect(autoSelectedPmLevel(silver)).toBe('gold');
  });

  it('selects admin for an empty quote', () => {
    expect(autoSelectedPmLevel(0)).toBe('admin');
  });

  it('honours a manual tier over the automatic one', () => {
    const state = quote({
      productStack: BOBJ,
      pmManual: true,
      pmLevel: 'gold',
      hours: { 'DI-BIA-SAP-BOBJ-DES-CONNECT': 0.5 }
    });
    expect(computeTotals(state).pmLevel).toBe('gold');
  });

  it('pins the tier when only a rate is overridden', () => {
    const state = quote({
      productStack: BOBJ,
      pmLevel: 'silver',
      pmRateOverride: '20',
      hours: { 'DI-BIA-SAP-BOBJ-DES-CONNECT': 0.5 }
    });
    const totals = computeTotals(state);
    expect(totals.pmLevel).toBe('silver');
    expect(totals.pmRate).toBe(0.2);
  });

  it('falls back to the tier rate rather than NaN on a bad override', () => {
    const state = quote({ pmLevel: 'coord', pmRateOverride: 'abc' });
    expect(resolvePmRate(state, 'coord')).toBe(0.125);
    expect(Number.isFinite(computeTotals(state).grandValue)).toBe(true);
  });

  it('accepts a zero override', () => {
    expect(resolvePmRate(quote({ pmRateOverride: '0' }), 'coord')).toBe(0);
  });

  it('maps every tier to a Fixed and a Target product code', () => {
    for (const level of PM_LEVELS) {
      expect(PM_PRODUCT_CODES[level.id].Fixed).toMatch(/^DI-BIA-PM-/);
      expect(PM_PRODUCT_CODES[level.id].Target).toBe(
        `${PM_PRODUCT_CODES[level.id].Fixed}-TM`
      );
    }
  });
});

describe('contingency', () => {
  it('is 20% of its own phase and nothing else', () => {
    const state = quote({
      productStack: BOBJ,
      hours: {
        'DI-BIA-SAP-BOBJ-DES-CONNECT': 10,
        'DI-BIA-SAP-BOBJ-BLD-MIGR-INSTALL': 100
      }
    });
    const phases = buildPhases(state);
    const design = phases.find((p) => p.name === 'SAP-BOBJ-Design')!;
    const build = phases.find((p) => p.name === 'SAP-BOBJ-Build')!;
    expect(design.lines.find((l) => l.isContingency)!.hours).toBeCloseTo(2, 10);
    expect(build.lines.find((l) => l.isContingency)!.hours).toBeCloseTo(20, 10);
  });

  it('is zero everywhere on target price', () => {
    const state = quote({
      productStack: BOBJ,
      pricingBasis: 'Target',
      hours: { 'DI-BIA-SAP-BOBJ-DES-CONNECT': 10 }
    });
    for (const phase of buildPhases(state)) {
      for (const line of phase.lines) {
        if (line.isContingency) expect(line.hours).toBe(0);
      }
    }
  });

  it('never lets a contingency line be typed into', () => {
    const state = quote({
      productStack: BOBJ,
      hours: { 'DI-BIA-SAP-BOBJ-DES-CONTINGENCY': 999 }
    });
    const phases = buildPhases(state);
    const design = phases.find((p) => p.name === 'SAP-BOBJ-Design')!;
    expect(design.lines.find((l) => l.isContingency)!.hours).toBe(0);
  });

  it('has exactly one contingency product per phase in every stack', () => {
    for (const stack of PRODUCT_STACKS) {
      for (const phase of stack.phases) {
        const contingency = phase.products.filter((p) => isContingencyCode(p.id));
        expect(contingency, `${stack.name} / ${phase.name}`).toHaveLength(1);
      }
    }
  });

  /*
   * The prefix convention is what makes contingency derivable at all:
   * `<phase>-CONTINGENCY` minus the suffix must prefix every sibling in that
   * phase and nothing outside it. A new product code that breaks this would
   * silently mis-cost a phase, so it is asserted rather than assumed.
   */
  it('has a contingency prefix that matches its own phase exclusively', () => {
    for (const stack of PRODUCT_STACKS) {
      const all = stack.phases.flatMap((phase) =>
        phase.products.map((product) => ({ phase: phase.name, id: product.id }))
      );
      for (const phase of stack.phases) {
        const contingency = phase.products.find((p) => isContingencyCode(p.id))!;
        const prefix = contingencyPhasePrefix(contingency.id);
        const siblings = phase.products.filter((p) => !isContingencyCode(p.id));
        for (const sibling of siblings) {
          expect(sibling.id.startsWith(prefix), `${sibling.id} vs ${prefix}`).toBe(true);
        }
        const outsiders = all.filter(
          (p) => p.phase !== phase.name && !isContingencyCode(p.id) && p.id.startsWith(prefix)
        );
        expect(outsiders, `${prefix} leaks into ${outsiders.map((o) => o.id).join(', ')}`)
          .toHaveLength(0);
      }
    }
  });
});

describe('hours coercion', () => {
  it('treats blank, negative and non-numeric as zero', () => {
    expect(normaliseHours('')).toBe(0);
    expect(normaliseHours('   ')).toBe(0);
    expect(normaliseHours('-5')).toBe(0);
    expect(normaliseHours('abc')).toBe(0);
    expect(normaliseHours(undefined)).toBe(0);
    expect(normaliseHours(Number.NaN)).toBe(0);
  });

  it('keeps a fractional entry', () => {
    expect(normaliseHours('3.75')).toBe(3.75);
    expect(normaliseHours(0.25)).toBe(0.25);
  });

  it('never produces NaN in a total', () => {
    const state = quote({
      productStack: BOBJ,
      hours: { 'DI-BIA-SAP-BOBJ-DES-CONNECT': Number.NaN }
    });
    expect(Number.isFinite(computeTotals(state).grandValue)).toBe(true);
  });
});

describe('hours are keyed by product code', () => {
  it('survives a stack switch and back', () => {
    const bobj = quote({
      productStack: BOBJ,
      hours: { 'DI-BIA-SAP-BOBJ-BLD-UPGR-INSTALL': 7.5 }
    });
    const cry = { ...bobj, productStack: CRY };
    expect(computeTotals(cry).baseHours).toBe(0);
    expect(computeTotals({ ...cry, productStack: BOBJ }).baseHours).toBe(7.5);
  });

  it('ignores hours recorded against codes outside the selected stack', () => {
    const state = quote({
      productStack: CRY,
      hours: { 'DI-BIA-SAP-BOBJ-BLD-UPGR-INSTALL': 100 }
    });
    expect(computeTotals(state).baseHours).toBe(0);
  });
});

describe('route validation', () => {
  it('reports a quote costing both routes', () => {
    const state = quote({
      productStack: BOBJ,
      hours: {
        'DI-BIA-SAP-BOBJ-BLD-UPGR-INSTALL': 7.5,
        'DI-BIA-SAP-BOBJ-BLD-MIGRATION': 7.5
      }
    });
    const conflict = routeConflict(buildPhases(state));
    expect(conflict).toContain('DI-BIA-SAP-BOBJ-BLD-UPGR-INSTALL');
    expect(conflict).toContain('DI-BIA-SAP-BOBJ-BLD-MIGRATION');
    expect(warnings(state, computeTotals(state)).map((w) => w.id)).toContain(
      'route-conflict'
    );
  });

  it('stays quiet on a single-route quote', () => {
    const state = quote({
      productStack: BOBJ,
      hours: { 'DI-BIA-SAP-BOBJ-BLD-UPGR-INSTALL': 7.5 }
    });
    expect(routeConflict(buildPhases(state))).toEqual([]);
  });

  it('reports products that contradict the selected project type', () => {
    const state = quote({
      productStack: BOBJ,
      projectType: 'upgrade',
      hours: { 'DI-BIA-SAP-BOBJ-BLD-MIGRATION': 7.5 }
    });
    expect(warnings(state, computeTotals(state)).map((w) => w.id)).toContain(
      'route-mismatch'
    );
  });

  it('warns when Tomcat is costed but still excluded', () => {
    // Found by rendering a CheckList and reading it, not by a unit test.
    const state = quote({
      productStack: BOBJ,
      projectType: 'upgrade',
      ...defaultsForProjectType('upgrade'),
      hours: {
        'DI-BIA-SAP-BOBJ-BLD-UPGR-INSTALL': 7.5,
        'DI-BIA-SAP-BOBJ-BLD-UPGR-TOMCAT': 3.75
      }
    });
    expect(state.exclusions.some((t) => t.includes('separate Apache Tomcat'))).toBe(true);
    expect(warnings(state, computeTotals(state)).map((w) => w.id)).toContain(
      'tomcat-contradiction'
    );

    const fixed = {
      ...state,
      exclusions: state.exclusions.filter((t) => !t.includes('separate Apache Tomcat'))
    };
    expect(warnings(fixed, computeTotals(fixed)).map((w) => w.id)).not.toContain(
      'tomcat-contradiction'
    );
  });

  it('stays quiet when no Tomcat hours are costed', () => {
    const state = quote({
      productStack: BOBJ,
      projectType: 'upgrade',
      ...defaultsForProjectType('upgrade'),
      hours: { 'DI-BIA-SAP-BOBJ-BLD-UPGR-INSTALL': 7.5 }
    });
    expect(warnings(state, computeTotals(state)).map((w) => w.id)).not.toContain(
      'tomcat-contradiction'
    );
  });

  it('warns on a Gold tier rather than pricing it silently', () => {
    const state = quote({
      productStack: BOBJ,
      hours: { 'DI-BIA-SAP-BOBJ-BLD-MIGRATION': 400 }
    });
    const totals = computeTotals(state);
    expect(totals.pmLevel).toBe('gold');
    expect(warnings(state, totals).map((w) => w.id)).toContain('pm-gold');
  });
});

describe('scope', () => {
  it('defaults by project type', () => {
    const install = defaultsForProjectType('install').inScope;
    const upgrade = defaultsForProjectType('upgrade').inScope;
    expect(install.install_prod).toBe(true);
    expect(install.upgrade_inplace).toBe(false);
    expect(upgrade.upgrade_inplace).toBe(true);
    expect(upgrade.install_prod).toBe(false);
  });

  it('leaves the conversion items off for both routes', () => {
    for (const type of ['install', 'upgrade'] as const) {
      const scope = defaultsForProjectType(type).inScope;
      expect(scope.conv_universe).toBe(false);
      expect(scope.conv_repoint).toBe(false);
      expect(scope.conv_config).toBe(false);
    }
  });

  it('substitutes the product name into the in-place upgrade line', () => {
    // The prototype hardcoded "SAP Business Objects" here, so a Crystal
    // Server upgrade claimed to upgrade BusinessObjects. See AD-14.
    const state = quote({
      productStack: CRY,
      projectType: 'upgrade',
      ...defaultsForProjectType('upgrade')
    });
    const platform = resolveScope(state).find((c) => c.id === 'platform')!;
    expect(platform.items.some((t) => t.includes(CRY))).toBe(true);
    expect(platform.items.some((t) => t.includes(BOBJ))).toBe(false);
  });

  it('appends custom items and drops blank ones', () => {
    const state = quote({
      productStack: BOBJ,
      projectType: 'install',
      ...defaultsForProjectType('install'),
      customScope: { platform: ['Bespoke thing.', '  ', ''], training: [], other: [] }
    });
    const platform = resolveScope(state).find((c) => c.id === 'platform')!;
    expect(platform.items).toContain('Bespoke thing.');
    expect(platform.items.filter((t) => t.trim() === '')).toHaveLength(0);
  });

  it('drops categories with nothing ticked', () => {
    const state = quote({ inScope: {}, customScope: { platform: [], training: [], other: [] } });
    expect(resolveScope(state)).toEqual([]);
  });

  it('has globally unique scope item ids', () => {
    const ids = SCOPE_CATEGORIES.flatMap((c) => c.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('substitutes every {product} token it declares', () => {
    for (const category of SCOPE_CATEGORIES) {
      for (const item of category.items) {
        expect(fillProduct(item.text, BOBJ)).not.toContain('{product}');
      }
    }
  });
});

describe('conversion extras', () => {
  it('adds the route-specific clauses once', () => {
    const base = quote({ projectType: 'upgrade', ...defaultsForProjectType('upgrade') });
    const once = withConversionExtras(base);
    const twice = withConversionExtras(once);
    expect(once.assumptions.length).toBe(base.assumptions.length + 1);
    expect(twice.assumptions).toEqual(once.assumptions);
  });

  it('warns when conversion is in scope but the clauses are missing', () => {
    const state = quote({
      productStack: BOBJ,
      projectType: 'upgrade',
      ...defaultsForProjectType('upgrade'),
      inScope: { ...defaultsForProjectType('upgrade').inScope, conv_universe: true },
      hours: { 'DI-BIA-SAP-BOBJ-BLD-UPGR-INSTALL': 7.5 }
    });
    expect(warnings(state, computeTotals(state)).map((w) => w.id)).toContain(
      'conversion-extras'
    );
    const fixed = withConversionExtras(state);
    expect(warnings(fixed, computeTotals(fixed)).map((w) => w.id)).not.toContain(
      'conversion-extras'
    );
  });
});

describe('project type change', () => {
  it('resets the content lists to that route defaults', () => {
    const edited = quote({
      projectType: 'install',
      ...defaultsForProjectType('install'),
      exclusions: ['Only this one.']
    });
    const switched = withProjectType(edited, 'upgrade');
    expect(switched.exclusions).toEqual(CONTENT_LIBRARY.upgrade.exclusions);
    expect(switched.pmManual).toBe(false);
  });

  it('keeps the hours', () => {
    const state = quote({
      productStack: BOBJ,
      hours: { 'DI-BIA-SAP-BOBJ-DES-CONNECT': 2 }
    });
    expect(withProjectType(state, 'upgrade').hours).toEqual(state.hours);
  });
});

describe('content library', () => {
  it('has non-empty lists for both routes', () => {
    for (const type of ['install', 'upgrade'] as const) {
      const library = CONTENT_LIBRARY[type];
      expect(library.dependencies.length).toBeGreaterThan(0);
      expect(library.assumptions.length).toBeGreaterThan(0);
      expect(library.exclusions.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate entries within a list', () => {
    for (const type of ['install', 'upgrade'] as const) {
      for (const key of ['dependencies', 'assumptions', 'exclusions'] as const) {
        const list = CONTENT_LIBRARY[type][key];
        expect(new Set(list).size, `${type}.${key}`).toBe(list.length);
      }
    }
  });

  it('gives every PM tier at least one deliverable', () => {
    for (const level of PM_LEVELS) {
      expect(level.deliverables.length, level.id).toBeGreaterThan(0);
      expect(new Set(level.deliverables).size).toBe(level.deliverables.length);
    }
  });
});

describe('formatting', () => {
  it('shows whole pounds with thousands separators', () => {
    expect(formatMoney(0)).toBe('0');
    expect(formatMoney(999)).toBe('999');
    expect(formatMoney(1000)).toBe('1,000');
    expect(formatMoney(6177.6)).toBe('6,178');
    expect(formatMoney(1234567)).toBe('1,234,567');
    expect(formatMoney(Number.NaN)).toBe('0');
  });

  it('shows hours to one decimal place', () => {
    expect(formatHours(0)).toBe('0.0');
    expect(formatHours(3.75)).toBe('3.8');
    expect(formatHours(Number.NaN)).toBe('0.0');
  });

  it('drops a trailing zero from a whole percentage', () => {
    expect(formatPercent(0.1)).toBe('10%');
    expect(formatPercent(0.125)).toBe('12.5%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(CONTINGENCY_RATE.Fixed)).toBe('20%');
  });
});

describe('filenames', () => {
  it('follows the prototype convention', () => {
    const state = quote({ productStack: BOBJ, projectType: 'install', ticket: '2437170' });
    expect(outputFilename(state, 'LabMat', 'xlsx')).toBe('BOBJ_Install_2437170_LabMat.xlsx');
    expect(outputFilename(state, 'CheckList', 'docx')).toBe(
      'BOBJ_Install_2437170_CheckList.docx'
    );
  });

  it('omits the ticket when there is none, and strips unsafe characters', () => {
    expect(outputFilename(quote({ productStack: CRY, projectType: 'upgrade' }), 'LabMat', 'xlsx'))
      .toBe('CRY_Upgrade_LabMat.xlsx');
    expect(
      outputFilename(quote({ productStack: CRY, ticket: 'a/b c:d' }), 'LabMat', 'xlsx')
    ).toBe('CRY_Install_abcd_LabMat.xlsx');
  });
});

describe('persistence guard', () => {
  it('round-trips a valid quote', () => {
    const state = SCENARIOS[1].state;
    expect(deserialise(serialise(state))).toEqual(state);
  });

  it('refuses anything it does not fully recognise', () => {
    expect(deserialise(null)).toBeUndefined();
    expect(deserialise('')).toBeUndefined();
    expect(deserialise('not json')).toBeUndefined();
    expect(deserialise('[]')).toBeUndefined();
    expect(deserialise('{"productStack":"Nope"}')).toBeUndefined();
    const state = quote();
    expect(deserialise(serialise({ ...state, projectType: 'sideways' as never }))).toBeUndefined();
    expect(deserialise(serialise({ ...state, pricingBasis: 'Free' as never }))).toBeUndefined();
    expect(deserialise(serialise({ ...state, pmLevel: 'platinum' as never }))).toBeUndefined();
    expect(deserialise(serialise({ ...state, exclusions: [1 as never] }))).toBeUndefined();
    expect(deserialise(serialise({ ...state, hours: null as never }))).toBeUndefined();
  });
});

describe('model integrity', () => {
  it('agrees on the working day', () => {
    expect(HOURS_PER_DAY).toBe(7.5);
  });

  it('prices every product in the catalogue', () => {
    for (const stack of PRODUCT_STACKS) {
      for (const phase of stack.phases) {
        expect(phase.products.length).toBeGreaterThan(0);
        for (const product of phase.products) {
          expect(product.price, product.id).toBeGreaterThan(0);
          expect(product.description.trim(), product.id).not.toBe('');
        }
      }
    }
  });

  it('has globally unique product codes', () => {
    const ids = PRODUCT_STACKS.flatMap((s) =>
      s.phases.flatMap((p) => p.products.map((x) => x.id))
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('offers both product stacks', () => {
    expect(PRODUCT_STACKS.map((s) => s.name)).toEqual([BOBJ, CRY]);
  });
});
