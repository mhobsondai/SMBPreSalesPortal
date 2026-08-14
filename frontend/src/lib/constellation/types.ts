/**
 * Decision Constellation — shapes.
 *
 * Kept apart from the model so `config/decisionConstellationModel.ts` can
 * import them without the model and the logic importing each other.
 */

export type NodeType = 'decision' | 'department' | 'system' | 'process';

/** A link always runs decision → hub. `kind` names the kind of hub. */
export type LinkKind = 'system' | 'department' | 'process';

export type Band = 'Now' | 'Next' | 'Later' | 'Watch';

export interface DecisionNode {
  id: string;
  label: string;
  type: 'decision';
  /** Owning department. */
  dept: string;
  /** Job title of the person who owns it. */
  role: string;
  cadence: string;
  horizon: string;
  /** How fresh the evidence has to be — "Days", "Months"… */
  latency: string;
  /** End-to-end process the decision belongs to. */
  spine: string;
  /** The system that holds most of the evidence. */
  primary: string;
  /** How it is decided today. */
  tooling: string;
  domains: string;
  metrics: string;
  /** Impact levers, 1–5. */
  rev: number;
  cost: number;
  cash: number;
  risk: number;
  /** How well it is served today (confidence), 1–5. */
  conf: number;
  /** How feasible it would be to serve properly, 1–5. */
  feas: number;
  /** Weighted blend of the four impact levers. */
  value: number;
  /** Capability gap. */
  gap: number;
  /** value × gap × feasibility. Carried in the data, not computed here. */
  priority: number;
  band: Band;
  /** Systems beyond `primary` that the decision draws on. */
  supporting: string[];
}

export interface HubNode {
  id: string;
  label: string;
  type: Exclude<NodeType, 'decision'>;
  /** Decisions attached to it across the whole dataset. */
  degree: number;
  /** Systems only — the tier the system sits in. */
  category?: string;
}

export type ConstellationNode = DecisionNode | HubNode;

export interface ConstellationLink {
  source: string;
  target: string;
  kind: LinkKind;
  /** Set on the link to the decision's primary system. */
  primary?: boolean;
}

export interface ConstellationDataset {
  nodes: ConstellationNode[];
  links: ConstellationLink[];
  /** Weights behind `value`. Recorded so the page can show the formula. */
  weights: Record<string, number>;
  /** Priority score at which each band starts. */
  bands: Record<string, number>;
}

export function isDecision(node: ConstellationNode): node is DecisionNode {
  return node.type === 'decision';
}
