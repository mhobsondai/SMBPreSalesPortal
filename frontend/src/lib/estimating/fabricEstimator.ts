/**
 * Fabric effort estimator — calculation.
 *
 * Pure functions, no DOM, no network. Arithmetic preserved exactly from
 * the standalone prototype; see `__fixtures__/reference.json`.
 *
 * days  = quantity × factor
 * hours = days × hoursPerDay
 */

import {
  FABRIC_MODEL,
  type EstimatorCategory,
  type EstimatorItem
} from '../../config/fabricEstimatorModel';

/** Quantities keyed by item id. Absent means zero. */
export type Quantities = Record<string, number>;

export interface LineResult {
  item: EstimatorItem;
  quantity: number;
  days: number;
  hours: number;
}

export interface CategoryResult {
  category: EstimatorCategory;
  lines: LineResult[];
  days: number;
  hours: number;
}

export interface EstimateResult {
  categories: CategoryResult[];
  totalDays: number;
  totalHours: number;
  /** True when nothing has been entered — used to show the empty state. */
  isEmpty: boolean;
}

/**
 * Format a number the way the prototype did: two decimal places at most,
 * thousands separated, and a bare "0" for anything within a rounding
 * whisker of zero.
 */
export function formatNumber(n: number): string {
  if (Math.abs(n) < 1e-9) return '0';
  return (Math.round(n * 100) / 100).toLocaleString(undefined, {
    maximumFractionDigits: 2
  });
}

/**
 * Coerce raw input to a usable quantity.
 *
 * Blank, negative and non-numeric all become 0 rather than propagating
 * NaN into the totals — a single bad keystroke should not blank the whole
 * estimate.
 */
export function normaliseQuantity(raw: string): number {
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value) || value < 0) return 0;
  return value;
}

export function calculateEstimate(
  quantities: Quantities,
  hoursPerDay: number,
  model: EstimatorCategory[] = FABRIC_MODEL
): EstimateResult {
  let totalDays = 0;
  let entered = 0;

  const categories = model.map((category) => {
    let categoryDays = 0;

    const lines = category.items.map((item) => {
      const quantity = quantities[item.id] ?? 0;
      if (quantity) entered += 1;
      const days = quantity * item.factor;
      categoryDays += days;
      return { item, quantity, days, hours: days * hoursPerDay };
    });

    totalDays += categoryDays;
    return {
      category,
      lines,
      days: categoryDays,
      hours: categoryDays * hoursPerDay
    };
  });

  return {
    categories,
    totalDays,
    totalHours: totalDays * hoursPerDay,
    isEmpty: entered === 0
  };
}

/**
 * Category bar widths, scaled to the largest category rather than to the
 * total.
 *
 * This makes the bars a *comparison* between categories, not a share of
 * the whole — the largest always reads 100%. Preserved from the
 * prototype, but worth knowing when reading a single-category estimate,
 * where the one populated bar will appear full.
 */
export function categoryBarPercents(result: EstimateResult): number[] {
  const max = Math.max(...result.categories.map((c) => c.days), 0.0001);
  return result.categories.map((c) => (c.days ? (c.days / max) * 100 : 0));
}

/** Plain-text estimate summary, suitable for pasting into a quote. */
export function summaryLines(result: EstimateResult, hoursPerDay: number): string[] {
  const lines: string[] = [];

  for (const group of result.categories) {
    for (const line of group.lines) {
      if (!line.quantity) continue;
      lines.push(
        `${group.category.category} · ${line.item.name}: ${line.quantity} × ${line.item.factor} = ${formatNumber(line.days)} days`
      );
    }
  }

  lines.push(
    `TOTAL: ${formatNumber(result.totalDays)} days → ${formatNumber(result.totalHours)} hours (at ${formatNumber(hoursPerDay)} h/day)`
  );

  return lines;
}
