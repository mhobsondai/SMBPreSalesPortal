/**
 * Fabric estimator — replay of the pinned prototype output.
 *
 * AD-09 records that the port was verified against seven cases. It was, but
 * by hand: the fixture stored the prototype's *outputs* and nothing
 * re-checked them afterwards, so a later factor change would have gone
 * unnoticed. See AD-10.
 *
 * ## Why the inputs are reconstructed
 *
 * `reference.json` records outputs only — it does not store the quantities
 * that produced them. Rather than edit a pinned file, this test recovers the
 * inputs from the recorded `lines` (each of which states its quantity) and
 * feeds them back through the port.
 *
 * That is not circular. The quantities are read from the line text; the
 * days, hours, category subtotals and formatted values are then recomputed
 * and compared. If a day factor changed, or the arithmetic drifted, the
 * recomputed figures would no longer match the pinned ones.
 *
 * **Follow-up:** storing the inputs alongside the outputs would remove the
 * reconstruction entirely. That means regenerating the fixture, which
 * CLAUDE.md rightly treats as a deliberate act, so it is left for a commit
 * of its own.
 */

import { describe, expect, it } from 'vitest';

import { FABRIC_MODEL, DEFAULT_HOURS_PER_DAY } from '../../config/fabricEstimatorModel';
import {
  calculateEstimate,
  categoryBarPercents,
  formatNumber,
  normaliseQuantity,
  summaryLines,
  type Quantities
} from './fabricEstimator';
import reference from './__fixtures__/reference.json';

interface ReferenceCase {
  name: string;
  grandDays: number;
  grandHours: number;
  catDays: number[];
  lines: string[];
  fmtDays: string;
  fmtHours: string;
}

const CASES = reference as ReferenceCase[];

/** `Fact · Small: 3 × 1.5 = 4.5 days` */
const LINE = /^(.+?) · (.+?): ([\d.]+) × ([\d.]+) = (.+) days$/;

function itemId(categoryName: string, itemName: string): string {
  const category = FABRIC_MODEL.find((c) => c.category === categoryName);
  const item = category?.items.find((i) => i.name === itemName);
  if (!item) throw new Error(`Fixture references unknown item: ${categoryName} · ${itemName}`);
  return item.id;
}

function inputsFor(testCase: ReferenceCase): {
  quantities: Quantities;
  hoursPerDay: number;
} {
  const quantities: Quantities = {};
  for (const line of testCase.lines) {
    const match = LINE.exec(line);
    if (!match) throw new Error(`Unparseable fixture line: ${line}`);
    const [, categoryName, itemName, quantity] = match;
    quantities[itemId(categoryName, itemName)] = Number.parseFloat(quantity);
  }

  // Recoverable from the totals except in the empty case, where hours are
  // zero for any rate and the default is the honest choice.
  const hoursPerDay =
    testCase.grandDays === 0
      ? DEFAULT_HOURS_PER_DAY
      : testCase.grandHours / testCase.grandDays;

  return { quantities, hoursPerDay };
}

describe.each(CASES)('reference case: $name', (testCase) => {
  const { quantities, hoursPerDay } = inputsFor(testCase);
  const result = calculateEstimate(quantities, hoursPerDay);

  it('reproduces total days', () => {
    expect(result.totalDays).toBeCloseTo(testCase.grandDays, 6);
  });

  it('reproduces total hours', () => {
    expect(result.totalHours).toBeCloseTo(testCase.grandHours, 6);
  });

  it('reproduces per-category days', () => {
    expect(result.categories.map((c) => c.days)).toHaveLength(testCase.catDays.length);
    result.categories.forEach((category, i) => {
      expect(category.days).toBeCloseTo(testCase.catDays[i], 6);
    });
  });

  it('reproduces the formatted totals', () => {
    expect(formatNumber(result.totalDays)).toBe(testCase.fmtDays);
    expect(formatNumber(result.totalHours)).toBe(testCase.fmtHours);
  });

  it('reproduces the summary lines', () => {
    // The last line is the TOTAL, which the fixture does not record.
    expect(summaryLines(result, hoursPerDay).slice(0, -1)).toEqual(testCase.lines);
  });
});

describe('normaliseQuantity', () => {
  it('coerces blank, negative and non-numeric to 0 rather than NaN', () => {
    // AD-09: a single bad keystroke must not blank the whole estimate.
    expect(normaliseQuantity('')).toBe(0);
    expect(normaliseQuantity('-4')).toBe(0);
    expect(normaliseQuantity('abc')).toBe(0);
    expect(normaliseQuantity('3')).toBe(3);
    expect(normaliseQuantity('2.5')).toBe(2.5);
  });
});

describe('formatNumber', () => {
  it('collapses a rounding whisker to a bare zero', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1e-12)).toBe('0');
  });

  it('caps at two decimal places', () => {
    expect(formatNumber(1.005)).toBe('1');
    expect(formatNumber(1.567)).toBe('1.57');
  });
});

describe('categoryBarPercents', () => {
  it('scales to the largest category, so the largest always reads 100', () => {
    // AD-09 preserved this from the prototype. It means a single-category
    // estimate shows one full bar, which the UI notes.
    const result = calculateEstimate({ 'fact-medium': 10 }, DEFAULT_HOURS_PER_DAY);
    const percents = categoryBarPercents(result);
    expect(Math.max(...percents)).toBe(100);
    expect(percents.filter((p) => p === 0)).toHaveLength(FABRIC_MODEL.length - 1);
  });

  it('is all zero for an empty estimate rather than NaN', () => {
    const percents = categoryBarPercents(calculateEstimate({}, DEFAULT_HOURS_PER_DAY));
    expect(percents.every((p) => p === 0)).toBe(true);
  });
});
