/**
 * Decision Constellation — model layer.
 *
 * ## What the dataset is
 *
 * `decisionConstellationData.json` is the worked example that came with the
 * prototype: 179 business decisions for a hypothetical £30–60m B2B importer
 * and distributor, wired out to the departments that own them, the process
 * spines they sit in and the source systems that hold their evidence.
 *
 * **There is no client data in it, and it is not a finding.** The scores are
 * first-pass estimates by way of illustration, deliberately pessimistic —
 * nothing is assumed to be well served. In a real engagement the scores are
 * the output of a workshop, not an input to it. The page says so on screen
 * and that statement has to stay true: if this file is ever swapped for a
 * client's own inventory, the standing notice on the tool has to change with
 * it, and the AD-08 question about personal data in the browser has to be
 * asked again.
 *
 * ## Why this is not "published methodology"
 *
 * Unlike `assessmentModel.ts`, `fabricEstimatorModel.ts` and
 * `sapQuoteGeneratorModel.ts`, nothing here reaches a client document or a
 * quote. `priority` is carried in the data rather than computed, so the tool
 * derives no number that could be wrong. What the fixture pins is the
 * *contract*: which decisions a given filter shows, and the graph that comes
 * out of it — taken from the original prototype, run in Node. See the note at
 * the top of `lib/constellation/__fixtures__/reference.json`.
 *
 * ## Colour
 *
 * These are the prototype's own values, unchanged. The tool keeps its
 * original look rather than the portal's — see the header comment on
 * `pages/tools/DecisionConstellation.css` and AD-18. Restyling it to the
 * portal palette later means changing these constants and that stylesheet,
 * and nothing else: no other file names a colour.
 */

import type { Band, ConstellationDataset, LinkKind, NodeType } from '../lib/constellation/types';
import dataset from './decisionConstellationData.json';

export const CONSTELLATION_DATA = dataset as unknown as ConstellationDataset;

/** Highest priority first. Drives the order of the band filter. */
export const BAND_ORDER: readonly Band[] = ['Now', 'Next', 'Later', 'Watch'];

/** Bands shown before the user touches anything — the top two. */
export const DEFAULT_BANDS: readonly Band[] = ['Now', 'Next'];

export const BAND_COLOUR: Record<Band, string> = {
  Now: '#D2603F',
  Next: '#C79A4E',
  Later: '#5C8F86',
  Watch: '#5E7791'
};

export const TYPE_COLOUR: Record<Exclude<NodeType, 'decision'>, string> = {
  department: '#9BB3C9',
  system: '#C9A96A',
  process: '#6FA69B'
};

export const LINK_COLOUR: Record<LinkKind, string> = {
  department: '#4A5D71',
  system: '#7A6A45',
  process: '#3E6259'
};

export const KIND_LABEL: Record<LinkKind, string> = {
  system: 'Source systems',
  department: 'Departments',
  process: 'Process spines'
};

/** The stage ground. Kept in step with `--dc-ground` in the stylesheet. */
export const STAGE_INK = '#0E141B';

/**
 * Force-simulation tuning, transcribed from the prototype. Changing these
 * changes only how the map settles, never what it shows.
 */
export const FORCE = {
  linkDistance: { system: 132, process: 104, department: 88 } as Record<LinkKind, number>,
  linkStrength: 0.3,
  /** Repulsion grows as the filtered view shrinks, so a single spine or
   *  department gets room to breathe instead of huddling. */
  charge: (nodeCount: number) => -(200 + 11000 / Math.max(nodeCount, 30)),
  centreStrength: { x: 0.032, y: 0.04 },
  collidePadding: { decision: 9, hub: 17 },
  zoomExtent: [0.25, 4] as [number, number]
};

/** Upper bound of the minimum-priority slider. */
export const MAX_PRIORITY_FILTER = 70;

/**
 * Geometry of the process view — the staged swimlanes the map switches to
 * when the filters isolate a single spine. Transcribed from the prototype.
 *
 * These are not cosmetic. Lane heights and the vertical fit are derived from
 * `rowStep` and `lanePadding`, and `columnWidth` sets both the stage column
 * and the width a decision's label has to wrap into — so changing one moves
 * every node. The pinned layouts in the fixture would all shift with them.
 */
export const PROCESS = {
  columnWidth: 198,
  rowStep: 38,
  lanePadding: 13,
  /** Height of the stage-header strip above the first lane. */
  headerHeight: 52,
  /** Gutter on the left holding the department name. */
  laneLabelWidth: 116,
  /** Node inset from the left edge of its stage column. */
  nodeInset: 20,
  /** Characters per line before a decision label wraps. */
  labelWrapAt: 23,
  /** Lines of label shown before it is cut with an ellipsis. */
  labelMaxLines: 2,
  /** Clearances kept for the focus bar above and the title block below. */
  fitInset: { top: 44, bottom: 96 },
  fitPadding: 20,
  fitScale: { min: 0.3, max: 1.05 }
};
