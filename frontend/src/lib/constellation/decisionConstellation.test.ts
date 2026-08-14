/**
 * Decision Constellation — port verification.
 *
 * `__fixtures__/reference.json` was produced by running the original
 * DecisionConstellation.html's own filtering logic in Node against the same
 * dataset, before any of this module was written. Every scenario below
 * replays its recorded inputs and asserts this port reproduces the recorded
 * outputs exactly.
 *
 * That is the CLAUDE.md rule for converting a prototype: diff the port
 * against the original's actual output, not against expectations. If a
 * scenario starts failing, the port is wrong until proven otherwise —
 * regenerate the fixture only alongside a deliberate behaviour change, and
 * say why in the same commit.
 */

import { describe, expect, it } from 'vitest';

import {
  BAND_ORDER,
  CONSTELLATION_DATA,
  DEFAULT_BANDS,
  PROCESS
} from '../../config/decisionConstellationModel';
import {
  activeProcessSpine,
  buildGraph,
  buildIndex,
  buildProcessLayout,
  decisionsForHub,
  defaultFilterState,
  departmentSpreadForHub,
  egoGraph,
  nodeRadius,
  nodeShapePath,
  stepLabelLines,
  summarise,
  visibleDecisions,
  wrapLabel,
  type FilterState
} from './decisionConstellation';
import { isDecision, type Band, type LinkKind } from './types';
import fixture from './__fixtures__/reference.json';

const index = buildIndex(CONSTELLATION_DATA);

type Scenario = (typeof fixture.scenarios)[keyof typeof fixture.scenarios];

/** Rebuild a filter state from the inputs the fixture recorded. */
function stateFor(scenario: Scenario): FilterState {
  const { state } = scenario;
  return {
    bands: new Set(state.bands as Band[]),
    departments:
      state.departments === 'all'
        ? new Set(index.departments)
        : new Set(state.departments as string[]),
    spines:
      state.spines === 'all' ? new Set(index.spines) : new Set(state.spines as string[]),
    systems:
      state.systems === 'all'
        ? new Set(index.systems.map((s) => s.id))
        : new Set(state.systems as string[]),
    kinds: new Set(state.kinds as LinkKind[]),
    minPriority: state.minPriority,
    query: state.query
  };
}

describe('dataset', () => {
  it('matches the shape the prototype was built on', () => {
    expect({
      nodes: CONSTELLATION_DATA.nodes.length,
      links: CONSTELLATION_DATA.links.length,
      decisions: index.decisions.length,
      departments: index.departments.length,
      spines: index.spines.length,
      systems: index.systems.length,
      weights: CONSTELLATION_DATA.weights,
      bands: CONSTELLATION_DATA.bands,
      spineStages: CONSTELLATION_DATA.spineStages
    }).toEqual(fixture.dataset);
  });

  it('gives every decision a stage that exists in its own spine', () => {
    // The process view indexes columns by `stageIndex`, so a stage naming a
    // step that is not in `spineStages[spine]` would place a node in thin air.
    for (const d of index.decisions) {
      const stages = CONSTELLATION_DATA.spineStages[d.spine];
      expect(stages, `${d.id} has spine ${d.spine}`).toBeDefined();
      expect(stages).toContain(d.stage);
      expect(stages[d.stageIndex]).toBe(d.stage);
    }
  });

  it('names stages for every spine, with no empty flow', () => {
    for (const spine of index.spines) {
      expect(CONSTELLATION_DATA.spineStages[spine]?.length).toBeGreaterThan(0);
    }
  });

  it('carries the counts the prose views quote', () => {
    // The Idea tab prints these four figures as statistics.
    expect(index.decisions.length).toBe(179);
    expect(index.departments.length).toBe(13);
    expect(index.spines.length).toBe(9);
    expect(index.systems.length).toBe(39);
  });

  it('attaches the ERP to 150 decisions, as the Example Business tab claims', () => {
    const erp = index.systems.find((s) => s.id === 'S:ERP');
    expect(erp?.degree).toBe(150);
    expect(decisionsForHub(CONSTELLATION_DATA, index, 'S:ERP')).toHaveLength(150);
  });

  it('holds no email address or other contact detail', () => {
    // The tool is a worked example on a hypothetical business. AD-08 turns on
    // this staying true — if a real client inventory is ever dropped in, the
    // personal-data question has to be asked again.
    expect(JSON.stringify(CONSTELLATION_DATA)).not.toMatch(/@/);
  });
});

describe('derivation', () => {
  it('lists departments in dataset order', () => {
    expect(index.departments).toEqual(fixture.derived.departments);
  });

  it('orders spines by decision count, busiest first', () => {
    expect(index.spines).toEqual(fixture.derived.spines);
    expect(index.spineCounts).toEqual(fixture.derived.spineCounts);
  });

  it('orders system tiers by total attachment, and systems within a tier by degree', () => {
    expect(index.systemGroups.map((g) => g.name)).toEqual(fixture.derived.systemGroupOrder);
    expect(
      Object.fromEntries(index.systemGroups.map((g) => [g.name, g.systems.map((s) => s.id)]))
    ).toEqual(fixture.derived.systemsByGroup);
  });

  it('counts decisions per band', () => {
    expect(index.bandCounts).toEqual(fixture.derived.bandCounts);
  });

  it('puts every system in exactly one tier', () => {
    const grouped = index.systemGroups.flatMap((g) => g.systems.map((s) => s.id));
    expect(grouped.slice().sort()).toEqual(index.systems.map((s) => s.id).sort());
  });
});

describe('filtering reproduces the prototype', () => {
  for (const [name, scenario] of Object.entries(fixture.scenarios)) {
    it(name, () => {
      const state = stateFor(scenario);
      const graph = buildGraph(CONSTELLATION_DATA, index, state);
      const summary = summarise(index, state, graph);

      expect(summary.decisions).toBe(scenario.expected.decisions);
      expect(summary.systems).toBe(scenario.expected.systems);
      expect(summary.links).toBe(scenario.expected.links);
      expect(summary.avgPriority).toBe(scenario.expected.avgPriority);
      expect(summary.sheet).toBe(scenario.expected.sheet);

      expect(graph.nodes.map((n) => n.id).sort()).toEqual(scenario.expected.nodeIds);

      const byKind: Record<string, number> = {};
      for (const l of graph.links) byKind[l.kind] = (byKind[l.kind] ?? 0) + 1;
      expect(byKind).toEqual(scenario.expected.linksByKind);

      const hubDegrees = Object.fromEntries(
        graph.nodes
          .filter((n) => !isDecision(n))
          .map((n) => [n.id, graph.shown[n.id]])
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      );
      expect(hubDegrees).toEqual(scenario.expected.hubDegrees);
    });
  }
});

describe('the default view', () => {
  const state = defaultFilterState(index, DEFAULT_BANDS);

  it('opens on the top two bands with everything else wide open', () => {
    expect([...state.bands].sort()).toEqual(['Next', 'Now']);
    expect(state.departments.size).toBe(index.departments.length);
    expect(state.spines.size).toBe(index.spines.length);
    expect(state.systems.size).toBe(index.systems.length);
    expect(state.minPriority).toBe(0);
    expect(state.query).toBe('');
  });

  it('matches the fixture’s default scenario', () => {
    const graph = buildGraph(CONSTELLATION_DATA, index, state);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(
      fixture.scenarios.default.expected.nodeIds
    );
  });

  it('shows fewer decisions than the whole inventory', () => {
    expect(visibleDecisions(index, state).length).toBeLessThan(index.decisions.length);
  });
});

describe('quirks kept from the prototype', () => {
  it('keeps a decision when any one of its systems is selected, not all', () => {
    // The move the Flexibility tab tells consultants to make: untick ERP and
    // look at what is left standing. Every decision in this dataset draws on
    // something besides the ERP, so all 179 survive — what disappears is the
    // ERP node itself and the 150 links into it. The point the demo makes is
    // therefore about the links, not about decisions vanishing.
    const all = defaultFilterState(index, BAND_ORDER);
    const withoutErp: FilterState = {
      ...all,
      systems: new Set(index.systems.map((s) => s.id).filter((id) => id !== 'S:ERP'))
    };
    const survivors = visibleDecisions(index, withoutErp);
    const erpBacked = survivors.filter((d) =>
      (index.decisionSystems[d.id] ?? []).includes('S:ERP')
    );
    expect(erpBacked).toHaveLength(150);
    expect(survivors).toHaveLength(index.decisions.length);

    const graph = buildGraph(CONSTELLATION_DATA, index, withoutErp);
    expect(graph.nodes.some((n) => n.id === 'S:ERP')).toBe(false);
    expect(graph.links).toHaveLength(
      buildGraph(CONSTELLATION_DATA, index, all).links.length - 150
    );
  });

  it('drops a decision only when none of its systems is selected', () => {
    // Narrowing to one tier does remove decisions — the corePlatformsWithoutErp
    // fixture scenario is the same move at tier level.
    const state: FilterState = {
      ...defaultFilterState(index, BAND_ORDER),
      systems: new Set(['S:ERP'])
    };
    expect(visibleDecisions(index, state)).toHaveLength(150);
  });

  it('says "0 systems" rather than "none selected" when every system is off', () => {
    const state: FilterState = { ...defaultFilterState(index), systems: new Set() };
    const graph = buildGraph(CONSTELLATION_DATA, index, state);
    expect(summarise(index, state, graph).sheet).toBe(
      'Full map — all departments · 0 systems'
    );
    expect(graph.nodes).toHaveLength(0);
  });

  it('reports an em dash for average priority when nothing is showing', () => {
    const state: FilterState = { ...defaultFilterState(index), departments: new Set() };
    const graph = buildGraph(CONSTELLATION_DATA, index, state);
    expect(summarise(index, state, graph).avgPriority).toBe('—');
  });

  it('names the focused decision in the sheet label, dropping the system suffix', () => {
    const state: FilterState = { ...defaultFilterState(index), systems: new Set(['S:ERP']) };
    const graph = buildGraph(CONSTELLATION_DATA, index, state);
    expect(summarise(index, state, graph, 'EXES-001').sheet).toBe('Focus — EXES-001');
  });
});

describe('search', () => {
  it('is case-insensitive and ignores surrounding whitespace', () => {
    const base = defaultFilterState(index, BAND_ORDER);
    const loud = buildGraph(CONSTELLATION_DATA, index, { ...base, query: '  LANDED Cost ' });
    const quiet = buildGraph(CONSTELLATION_DATA, index, { ...base, query: 'landed cost' });
    expect(loud.nodes.map((n) => n.id)).toEqual(quiet.nodes.map((n) => n.id));
  });

  it('matches on metrics and source system, not only the decision label', () => {
    const base = defaultFilterState(index, BAND_ORDER);
    const hits = visibleDecisions(index, { ...base, query: 'wms' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((d) => !d.label.toLowerCase().includes('wms'))).toBe(true);
  });

  it('returns nothing for a term that appears nowhere', () => {
    const base = defaultFilterState(index, BAND_ORDER);
    expect(visibleDecisions(index, { ...base, query: 'zzzznope' })).toEqual([]);
  });
});

describe('the ego view', () => {
  const decision = index.decisions[0];
  const ego = egoGraph(CONSTELLATION_DATA, decision.id);

  it('holds the decision, its department, its spine and its systems', () => {
    expect(ego.nodes.some((n) => n.id === decision.id)).toBe(true);
    expect(ego.nodes.filter((n) => n.type === 'department')).toHaveLength(1);
    expect(ego.nodes.filter((n) => n.type === 'process')).toHaveLength(1);
    expect(ego.nodes.filter((n) => n.type === 'system').length).toBeGreaterThan(0);
  });

  it('links every hub back to the decision and nothing else', () => {
    expect(ego.links.every((l) => l.source === decision.id)).toBe(true);
    expect(ego.links).toHaveLength(ego.nodes.length - 1);
  });

  it('includes the primary system among them', () => {
    const systems = ego.nodes.filter((n) => n.type === 'system').map((n) => n.label);
    expect(systems).toContain(decision.primary);
  });
});

describe('hub panels', () => {
  const decisions = decisionsForHub(CONSTELLATION_DATA, index, 'S:ERP');

  it('sorts a hub’s decisions by priority, highest first', () => {
    const priorities = decisions.map((d) => d.priority);
    expect(priorities).toEqual(priorities.slice().sort((a, b) => b - a));
  });

  it('spreads them across departments, busiest first', () => {
    const spread = departmentSpreadForHub(decisions);
    expect(spread.length).toBeGreaterThan(1);
    expect(spread.map(([, n]) => n)).toEqual(
      spread.map(([, n]) => n).slice().sort((a, b) => b - a)
    );
    expect(spread.reduce((t, [, n]) => t + n, 0)).toBe(decisions.length);
  });
});

describe('geometry', () => {
  it('sizes a decision by its priority', () => {
    const [low, high] = [...index.decisions].sort((a, b) => a.priority - b.priority);
    expect(nodeRadius(high)).toBeGreaterThan(nodeRadius(low));
  });

  it('sizes a hub by how much of it is on screen', () => {
    const hub = index.systems[0];
    expect(nodeRadius(hub, 40)).toBeGreaterThan(nodeRadius(hub, 4));
  });

  it('draws a different shape per node type', () => {
    const paths = new Set(
      [
        index.decisions[0],
        index.systems[0],
        CONSTELLATION_DATA.nodes.find((n) => n.type === 'department')!,
        CONSTELLATION_DATA.nodes.find((n) => n.type === 'process')!
      ].map((n) => nodeShapePath(n, 6).replace(/[\d.-]+/g, ''))
    );
    expect(paths.size).toBe(4);
  });
});

describe('the process view', () => {
  function layoutFor(state: FilterState) {
    return buildProcessLayout(CONSTELLATION_DATA, index, state, PROCESS);
  }

  function spineState(spine: string, bands = BAND_ORDER): FilterState {
    return { ...defaultFilterState(index, bands), spines: new Set([spine]) };
  }

  describe('reproduces the prototype', () => {
    for (const [name, expected] of Object.entries(fixture.process)) {
      it(name, () => {
        const state = name.includes('Now and Next')
          ? spineState(expected.spine, DEFAULT_BANDS)
          : spineState(expected.spine);
        const layout = layoutFor(state)!;

        expect(layout.spine).toBe(expected.spine);
        expect(layout.stages).toEqual(expected.stages);
        expect(layout.decisions).toBe(expected.decisions);
        expect(layout.emptyStages).toEqual(expected.emptyStages);
        expect(layout.totalWidth).toBe(expected.totalWidth);
        expect(layout.totalHeight).toBe(expected.totalHeight);
        expect(layout.lanes).toEqual(expected.lanes);
        expect(
          layout.placed.map((p) => ({ id: p.decision.id, x: p.x, y: p.y }))
        ).toEqual(expected.placed);
        expect({
          decisions: layout.decisions,
          departments: layout.lanes.length,
          stages: layout.stages.length,
          avgPriority: layout.avgPriority
        }).toEqual(expected.titleBlock);
      });
    }
  });

  it('applies only when exactly one spine is selected', () => {
    expect(activeProcessSpine(defaultFilterState(index))).toBeNull();
    expect(activeProcessSpine(spineState('Strategy'))).toBe('Strategy');
    expect(
      activeProcessSpine({ ...defaultFilterState(index), spines: new Set() })
    ).toBeNull();
    expect(
      activeProcessSpine({
        ...defaultFilterState(index),
        spines: new Set(['Strategy', 'Quote-to-cash'])
      })
    ).toBeNull();
    expect(layoutFor(defaultFilterState(index))).toBeNull();
  });

  it('lays every spine out, so no selection can reach a broken view', () => {
    for (const spine of index.spines) {
      const layout = layoutFor(spineState(spine))!;
      expect(layout.stages.length).toBeGreaterThan(0);
      expect(layout.lanes.length).toBeGreaterThan(0);
      expect(layout.placed.length).toBe(layout.decisions);
    }
  });

  it('places every visible decision of the spine exactly once', () => {
    const state = spineState('Quote-to-cash');
    const expected = visibleDecisions(index, state).filter(
      (d) => d.spine === 'Quote-to-cash'
    );
    const layout = layoutFor(state)!;
    expect(layout.placed).toHaveLength(expected.length);
    expect(new Set(layout.placed.map((p) => p.decision.id))).toEqual(
      new Set(expected.map((d) => d.id))
    );
  });

  it('puts a decision in the column its stageIndex names', () => {
    const layout = layoutFor(spineState('Quote-to-cash'))!;
    for (const { decision, x } of layout.placed) {
      expect(x).toBe(layout.columnX(decision.stageIndex) + PROCESS.nodeInset);
    }
  });

  it('orders lanes by decision count, busiest first', () => {
    const counts = layoutFor(spineState('Quote-to-cash'))!.lanes.map((l) => l.count);
    expect(counts).toEqual(counts.slice().sort((a, b) => b - a));
  });

  it('stacks lanes without gaps or overlaps', () => {
    const layout = layoutFor(spineState('Purchase-to-pay'))!;
    let y = PROCESS.headerHeight;
    for (const lane of layout.lanes) {
      expect(lane.y).toBe(y);
      y += lane.height;
    }
    expect(layout.totalHeight).toBe(y);
  });

  it('sizes a lane to its busiest cell', () => {
    const layout = layoutFor(spineState('Quote-to-cash'))!;
    for (const lane of layout.lanes) {
      const inLane = layout.placed.filter((p) => p.decision.dept === lane.dept);
      const busiest = Math.max(
        ...layout.stages.map(
          (s) => inLane.filter((p) => p.decision.stage === s).length
        )
      );
      expect(lane.height).toBe(
        Math.max(1, busiest) * PROCESS.rowStep + PROCESS.lanePadding * 2
      );
      // Every node in the lane sits inside it.
      for (const p of inLane) {
        expect(p.y).toBeGreaterThanOrEqual(lane.y);
        expect(p.y).toBeLessThan(lane.y + lane.height);
      }
    }
  });

  it('puts the highest-priority decision at the top of a cell', () => {
    const layout = layoutFor(spineState('Quote-to-cash'))!;
    const cells = new Map<string, typeof layout.placed>();
    for (const p of layout.placed) {
      const key = `${p.decision.dept}|${p.decision.stage}`;
      cells.set(key, [...(cells.get(key) ?? []), p]);
    }
    for (const bucket of cells.values()) {
      const byY = bucket.slice().sort((a, b) => a.y - b.y);
      const priorities = byY.map((p) => p.decision.priority);
      expect(priorities).toEqual(priorities.slice().sort((a, b) => b - a));
    }
  });

  it('reports a stage with nothing in it rather than dropping the column', () => {
    // Two stages of the example are empty at full width; both must still be
    // drawn, or the flow silently loses a step.
    const strategy = layoutFor(spineState('Strategy'))!;
    expect(strategy.emptyStages).toEqual(['Review']);
    expect(strategy.stages).toContain('Review');
    expect(layoutFor(spineState('Hire-to-retire'))!.emptyStages).toEqual(['Onboard']);
  });

  it('still honours the other filters', () => {
    const all = layoutFor(spineState('Quote-to-cash'))!;
    const narrowed = layoutFor(spineState('Quote-to-cash', DEFAULT_BANDS))!;
    expect(narrowed.decisions).toBeLessThan(all.decisions);
    expect(narrowed.totalHeight).toBeLessThan(all.totalHeight);
    // Columns never change — the flow is the spine's, not the filter's.
    expect(narrowed.stages).toEqual(all.stages);
    expect(narrowed.totalWidth).toBe(all.totalWidth);
  });

  it('empties out rather than breaking when a filter excludes everything', () => {
    const state: FilterState = { ...spineState('Strategy'), query: 'zzzznope' };
    const layout = layoutFor(state)!;
    expect(layout.placed).toEqual([]);
    expect(layout.lanes).toEqual([]);
    expect(layout.decisions).toBe(0);
    expect(layout.avgPriority).toBe('—');
    expect(layout.emptyStages).toEqual(layout.stages);
    expect(layout.totalHeight).toBe(PROCESS.headerHeight);
  });
});

describe('the process view’s step labels', () => {
  for (const [label, expected] of Object.entries(fixture.stepLabels)) {
    it(`wraps “${label.slice(0, 32)}…”`, () => {
      expect(stepLabelLines(label, PROCESS.labelWrapAt, PROCESS.labelMaxLines)).toEqual(
        expected
      );
    });
  }

  it('leaves a label that fits alone, with no ellipsis', () => {
    expect(stepLabelLines('Rebate accrual', PROCESS.labelWrapAt, 2)).toEqual([
      'Rebate accrual'
    ]);
  });

  it('strips trailing punctuation before the ellipsis', () => {
    const lines = stepLabelLines(
      'One two three four five, six seven eight nine ten eleven',
      PROCESS.labelWrapAt,
      2
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/…$/);
    expect(lines[1]).not.toMatch(/[,;]…$/);
  });
});

describe('label wrapping', () => {
  it('breaks a long label into readable lines', () => {
    const lines = wrapLabel('Which market segments / verticals to prioritise for growth');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('Which market segments / verticals to prioritise for growth');
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(30);
  });

  it('leaves a short label alone', () => {
    expect(wrapLabel('Rebate accrual')).toEqual(['Rebate accrual']);
  });
});
