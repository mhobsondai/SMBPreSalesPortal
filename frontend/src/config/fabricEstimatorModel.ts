/**
 * Microsoft Fabric effort estimator — day-factor model.
 *
 * Ported from the standalone `fabric_estimator.html` prototype, whose
 * factors mirror the source `Fabric calculator.xlsx`.
 *
 * **These factors are the estimating basis.** They feed quotes. Treat a
 * change here as a change to commercial pricing, not a code edit:
 *   - the same inputs must produce the same estimate next month
 *   - two consultants estimating the same scope must agree
 *   - `lib/estimating/__fixtures__` pins reference outputs; if a factor
 *     change makes a fixture wrong, regenerate it in the same commit and
 *     say why
 */

export interface EstimatorItem {
  /** Stable identifier — used as a React key and in saved estimates. */
  id: string;
  name: string;
  /** Delivery days per unit. */
  factor: number;
}

export interface EstimatorCategory {
  id: string;
  category: string;
  items: EstimatorItem[];
}

export const FABRIC_MODEL: EstimatorCategory[] = [
  {
    id: 'fact',
    category: 'Fact',
    items: [
      { id: 'fact-small', name: 'Small', factor: 1.5 },
      { id: 'fact-medium', name: 'Medium', factor: 2 },
      { id: 'fact-large', name: 'Large', factor: 2.5 }
    ]
  },
  {
    id: 'dimension',
    category: 'Dimension',
    items: [
      { id: 'dim-noscd', name: 'NoSCD', factor: 1 },
      { id: 'dim-scd', name: 'SCD', factor: 2 }
    ]
  },
  {
    id: 'ingestion',
    category: 'Source Ingestion',
    items: [
      { id: 'ing-sql', name: 'SQL', factor: 1 },
      { id: 'ing-api', name: 'API', factor: 2 },
      { id: 'ing-excel', name: 'Excel', factor: 1 }
    ]
  }
];

/** Codestone standard working day. */
export const DEFAULT_HOURS_PER_DAY = 7.5;
