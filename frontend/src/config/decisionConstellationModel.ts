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
 * The prose views use the portal's light palette. The map does not: it is
 * rendered on a night sky, because a force-directed graph of 240 nodes is
 * unreadable on white and because "constellation" is the point being made.
 * The hues below are the portal's accents lifted for a dark ground rather
 * than a second palette — orange leads, and each band keeps the portal's
 * status ordering (orange → amber → green → blue).
 */

import type { Band, ConstellationDataset, LinkKind, NodeType } from '../lib/constellation/types';
import dataset from './decisionConstellationData.json';

export const CONSTELLATION_DATA = dataset as unknown as ConstellationDataset;

/** Highest priority first. Drives the order of the band filter. */
export const BAND_ORDER: readonly Band[] = ['Now', 'Next', 'Later', 'Watch'];

/** Bands shown before the user touches anything — the top two. */
export const DEFAULT_BANDS: readonly Band[] = ['Now', 'Next'];

export const BAND_COLOUR: Record<Band, string> = {
  Now: '#ff7a29',
  Next: '#f0a830',
  Later: '#3fbf8f',
  Watch: '#5b8fd6'
};

export const TYPE_COLOUR: Record<Exclude<NodeType, 'decision'>, string> = {
  department: '#aab7dd',
  system: '#e3cb8c',
  process: '#7fd4c1'
};

export const LINK_COLOUR: Record<LinkKind, string> = {
  department: '#4b5583',
  system: '#7a6a45',
  process: '#3e6259'
};

export const KIND_LABEL: Record<LinkKind, string> = {
  system: 'Source systems',
  department: 'Departments',
  process: 'Process spines'
};

/** Night-sky ground for the map stage. Referenced from CSS too. */
export const STAGE_INK = '#0f1020';

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
