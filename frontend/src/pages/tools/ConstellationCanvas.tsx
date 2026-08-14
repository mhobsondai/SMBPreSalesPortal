import { useEffect, useRef } from 'react';
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum
} from 'd3-force';
import { drag as d3drag } from 'd3-drag';
import { select, type Selection } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import 'd3-transition';

import {
  BAND_COLOUR,
  FORCE,
  LINK_COLOUR,
  TYPE_COLOUR
} from '../../config/decisionConstellationModel';
import {
  nodeRadius,
  nodeShapePath,
  wrapLabel,
  type ConstellationGraph
} from '../../lib/constellation/decisionConstellation';
import {
  isDecision,
  type ConstellationNode,
  type DecisionNode,
  type LinkKind
} from '../../lib/constellation/types';

/**
 * The map itself.
 *
 * React owns the chrome around it — the filter rail, the title block, the
 * inspector — and this component owns the SVG. d3 keeps the imperative half
 * because zoom, drag and the force simulation all want to write to the DOM
 * sixty times a second, and re-rendering 240 nodes through React on every
 * tick is the one thing that would make this feel slow.
 *
 * The boundary is narrow on purpose: props in, `onSelect` out. Nothing here
 * decides what is on the map — `lib/constellation/decisionConstellation.ts`
 * does, and it is tested against the original prototype.
 *
 * Node positions live in `instances` and survive a filter change, so
 * narrowing the view rearranges the map rather than scattering it.
 */

type SimNode = ConstellationNode & SimulationNodeDatum & { shown: number };

interface SimLink {
  source: SimNode;
  target: SimNode;
  kind: LinkKind;
  primary?: boolean;
}

interface CanvasProps {
  graph: ConstellationGraph;
  /** Non-null puts the map in the radial ego view for that decision. */
  focus: DecisionNode | null;
  /** True while the inspector covers the right-hand strip of the stage. */
  inspectorOpen: boolean;
  onSelect: (node: ConstellationNode) => void;
  /** Clicking empty space while focused. */
  onDismiss: () => void;
}

const STAR_COUNT = 190;

/** Must match `.dc-inspector` in DecisionConstellation.css. */
const INSPECTOR_WIDTH = 352;

/** The breakpoint at which the inspector goes full width — same file. */
const NARROW = '(max-width: 980px)';

/** Deterministic, so the sky does not reshuffle on every render. */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function colourOf(node: ConstellationNode): string {
  return isDecision(node) ? BAND_COLOUR[node.band] : TYPE_COLOUR[node.type];
}

export function ConstellationCanvas({
  graph,
  focus,
  inspectorOpen,
  onSelect,
  onDismiss
}: CanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Callbacks change identity on every parent render; the engine is built
  // once, so it reads them through a ref rather than being rebuilt.
  const handlers = useRef({ onSelect, onDismiss });
  handlers.current = { onSelect, onDismiss };

  const engine = useRef<ReturnType<typeof createEngine> | null>(null);

  useEffect(() => {
    if (!svgRef.current || !stageRef.current) return undefined;
    engine.current = createEngine(svgRef.current, stageRef.current, handlers);
    return () => {
      engine.current?.destroy();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    engine.current?.apply(graph, focus, inspectorOpen);
  }, [graph, focus, inspectorOpen]);

  return (
    <div className="dc-canvas" ref={stageRef}>
      <svg
        ref={svgRef}
        role="img"
        aria-label="Network map of business decisions, departments, source systems and process spines"
      />
    </div>
  );
}

function createEngine(
  svgEl: SVGSVGElement,
  stageEl: HTMLDivElement,
  handlers: { current: { onSelect: (n: ConstellationNode) => void; onDismiss: () => void } }
) {
  const svg = select(svgEl);
  const sky = svg.append('g').attr('class', 'dc-sky');
  const root = svg.append('g');
  const gLink = root.append('g');
  const gNode = root.append('g');
  const gLabel = root.append('g');

  let width = 0;
  let height = 0;
  let userZoomed = false;
  let focused: DecisionNode | null = null;
  let inspectorOpen = false;
  let current: { nodes: SimNode[]; links: SimLink[] } = { nodes: [], links: [] };
  let pending: {
    graph: ConstellationGraph;
    focus: DecisionNode | null;
    inspectorOpen: boolean;
  } | null = null;
  let started = false;

  /** One instance per node id, reused so positions persist across filters. */
  const instances = new Map<string, SimNode>();

  function instance(node: ConstellationNode, shown: number): SimNode {
    const existing = instances.get(node.id);
    if (existing) {
      existing.shown = shown;
      return existing;
    }
    const created = { ...node, shown } as SimNode;
    instances.set(node.id, created);
    return created;
  }

  const zoomBehaviour: ZoomBehavior<SVGSVGElement, unknown> = d3zoom<SVGSVGElement, unknown>()
    .scaleExtent(FORCE.zoomExtent)
    .on('zoom', (event) => {
      root.attr('transform', event.transform.toString());
      if (event.sourceEvent) userZoomed = true;
    });

  svg
    .call(zoomBehaviour)
    .on('mousedown.cursor', () => svg.classed('is-dragging', true))
    .on('mouseup.cursor', () => svg.classed('is-dragging', false))
    .on('click', () => {
      if (focused) handlers.current.onDismiss();
    });

  const sim: Simulation<SimNode, SimLink> = forceSimulation<SimNode>()
    .force(
      'link',
      forceLink<SimNode, SimLink>()
        .id((d) => d.id)
        .distance((l) => FORCE.linkDistance[l.kind])
        .strength(FORCE.linkStrength)
    )
    .force('charge', forceManyBody<SimNode>().strength(FORCE.charge(240)))
    .force('collide', forceCollide<SimNode>().radius(collideRadius))
    .force('x', forceX<SimNode>(() => width / 2).strength(FORCE.centreStrength.x))
    .force('y', forceY<SimNode>(() => height / 2).strength(FORCE.centreStrength.y))
    .on('tick', tick)
    .on('end', fitView);

  function collideRadius(d: SimNode): number {
    return (
      nodeRadius(d, d.shown) +
      (d.type === 'decision' ? FORCE.collidePadding.decision : FORCE.collidePadding.hub)
    );
  }

  function measure(): boolean {
    const rect = stageEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const changed = rect.width !== width || rect.height !== height;
    width = rect.width;
    height = rect.height;
    if (changed) {
      svg.attr('viewBox', `0 0 ${width} ${height}`);
      drawSky();
    }
    return true;
  }

  /**
   * A static field of stars, drawn outside the zoom group so the sky stays
   * put while the map moves across it.
   */
  function drawSky() {
    const random = seededRandom(20260814);
    const stars = Array.from({ length: STAR_COUNT }, () => ({
      x: random() * width,
      y: random() * height,
      r: 0.4 + random() * 1.15,
      o: 0.12 + random() * 0.42
    }));
    const sel = sky.selectAll<SVGCircleElement, (typeof stars)[number]>('circle').data(stars);
    sel.exit().remove();
    sel
      .enter()
      .append('circle')
      .merge(sel)
      .attr('cx', (s) => s.x)
      .attr('cy', (s) => s.y)
      .attr('r', (s) => s.r)
      .attr('fill', '#ffffff')
      .attr('opacity', (s) => s.o);
  }

  function tick() {
    if (focused) return;
    gLink
      .selectAll<SVGLineElement, SimLink>('line')
      .attr('x1', (l) => l.source.x ?? 0)
      .attr('y1', (l) => l.source.y ?? 0)
      .attr('x2', (l) => l.target.x ?? 0)
      .attr('y2', (l) => l.target.y ?? 0);
    gNode
      .selectAll<SVGGElement, SimNode>('g.dc-node')
      .attr('transform', (n) => `translate(${n.x ?? 0},${n.y ?? 0})`);
    gLabel
      .selectAll<SVGTextElement, SimNode>('text.dc-hublabel')
      .attr('x', (n) => n.x ?? 0)
      .attr('y', (n) => (n.y ?? 0) - nodeRadius(n, n.shown) - 8);
    gLabel
      .selectAll<SVGTextElement, SimNode>('text.dc-hovlabel')
      .attr('x', (n) => n.x ?? 0)
      .attr('y', (n) => (n.y ?? 0) - nodeRadius(n, n.shown) - 9);
  }

  /** Zoom out just enough that the settled layout fits, unless the user has
   *  taken control of the zoom themselves. */
  function fitView() {
    if (userZoomed || focused || !current.nodes.length) return;
    const xs = current.nodes.map((n) => n.x ?? 0);
    const ys = current.nodes.map((n) => n.y ?? 0);
    const pad = 84;
    const x0 = Math.min(...xs) - pad;
    const x1 = Math.max(...xs) + pad;
    const y0 = Math.min(...ys) - pad;
    const y1 = Math.max(...ys) + pad;
    const k = Math.max(
      0.25,
      Math.min(1.3, 0.98 * Math.min(width / (x1 - x0), height / (y1 - y0)))
    );
    const tx = width / 2 - (k * (x0 + x1)) / 2;
    const ty = height / 2 - (k * (y0 + y1)) / 2;
    svg
      .transition()
      .duration(500)
      .call(zoomBehaviour.transform, zoomIdentity.translate(tx, ty).scale(k));
  }

  function hoverLabel(node: SimNode | null) {
    gLabel.selectAll('text.dc-hovlabel').remove();
    if (!node || !isDecision(node)) return;
    gLabel
      .append('text')
      .datum(node)
      .attr('class', 'dc-declabel dc-hovlabel')
      .attr('text-anchor', 'middle')
      .attr('x', node.x ?? 0)
      .attr('y', (node.y ?? 0) - nodeRadius(node, node.shown) - 9)
      .text(node.label.length > 52 ? `${node.label.slice(0, 50)}…` : node.label);
  }

  function highlight(node: SimNode | null) {
    if (focused) return;
    hoverLabel(node);
    const nodeSel = gNode.selectAll<SVGGElement, SimNode>('g.dc-node');
    const linkSel = gLink.selectAll<SVGLineElement, SimLink>('line');
    if (!node) {
      nodeSel.classed('is-faded', false);
      linkSel.classed('is-faded', false).classed('is-lit', false);
      gLabel.selectAll('text').style('opacity', 1);
      return;
    }
    const near = new Set([node.id]);
    for (const l of current.links) {
      if (l.source.id === node.id) near.add(l.target.id);
      if (l.target.id === node.id) near.add(l.source.id);
    }
    nodeSel.classed('is-faded', (n) => !near.has(n.id));
    linkSel
      .classed('is-lit', (l) => l.source.id === node.id || l.target.id === node.id)
      .classed('is-faded', (l) => !(l.source.id === node.id || l.target.id === node.id));
    gLabel
      .selectAll<SVGTextElement, SimNode>('text')
      .style('opacity', (n) => (n && near.has(n.id) ? 1 : 0.12));
  }

  function paintNodes(selection: Selection<SVGGElement, SimNode, SVGGElement, unknown>) {
    selection
      .select<SVGPathElement>('path.dc-halo')
      .attr('d', (n) => nodeShapePath(n, n.shown))
      .attr('fill', colourOf)
      .attr('transform', 'scale(2.3)');
    selection
      .select<SVGPathElement>('path.dc-shape')
      .attr('d', (n) => nodeShapePath(n, n.shown))
      .attr('fill', colourOf);
  }

  function renderForce(graph: ConstellationGraph) {
    const nodes = graph.nodes.map((n) => instance(n, graph.shown[n.id] ?? 0));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: SimLink[] = graph.links.map((l) => ({
      source: byId.get(l.source)!,
      target: byId.get(l.target)!,
      kind: l.kind,
      primary: l.primary
    }));
    current = { nodes, links };

    const linkSel = gLink
      .selectAll<SVGLineElement, SimLink>('line')
      .data(links, (l) => `${l.source.id}>${l.target.id}`);
    linkSel.exit().remove();
    linkSel
      .enter()
      .append('line')
      .attr('class', (l) => `dc-link dc-link--${l.kind}`)
      .attr('stroke', (l) => LINK_COLOUR[l.kind])
      .attr('stroke-width', (l) => (l.primary ? 1.5 : 0.8));

    const nodeSel = gNode.selectAll<SVGGElement, SimNode>('g.dc-node').data(nodes, (n) => n.id);
    nodeSel.exit().remove();
    const entered = nodeSel
      .enter()
      .append('g')
      .attr('class', 'dc-node')
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', (n) => n.label);
    entered.append('path').attr('class', 'dc-halo');
    entered.append('path').attr('class', 'dc-shape');
    entered
      .on('click', (event: MouseEvent, n) => {
        event.stopPropagation();
        handlers.current.onSelect(n);
      })
      .on('keydown', (event: KeyboardEvent, n) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handlers.current.onSelect(n);
        }
      })
      .on('mouseenter', (_event: MouseEvent, n) => highlight(n))
      .on('mouseleave', () => highlight(null));

    const merged = entered.merge(nodeSel);
    paintNodes(merged);
    merged.call(
      d3drag<SVGGElement, SimNode>()
        .on('start', (event, d) => {
          if (!event.active) sim.alphaTarget(0.25).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) sim.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
    );

    const hubs = nodes.filter((n) => !isDecision(n));
    const labelSel = gLabel
      .selectAll<SVGTextElement, SimNode>('text.dc-hublabel')
      .data(hubs, (n) => n.id);
    labelSel.exit().remove();
    labelSel
      .enter()
      .append('text')
      .attr('class', 'dc-hublabel')
      .attr('text-anchor', 'middle')
      .text((n) => n.label);

    sim.nodes(nodes);
    sim.force<ReturnType<typeof forceLink<SimNode, SimLink>>>('link')?.links(links);
    sim.force<ReturnType<typeof forceCollide<SimNode>>>('collide')?.radius(collideRadius);
    sim.force('charge', forceManyBody<SimNode>().strength(FORCE.charge(nodes.length)));
    userZoomed = false;
    sim.alpha(0.85).restart();
  }

  /**
   * The ego view: the decision in the middle, its department above, its
   * systems fanned out to the left and its process spine to the right. Laid
   * out by hand rather than simulated — the reading only works if the sides
   * mean something.
   */
  function renderFocus(decision: DecisionNode, graph: ConstellationGraph) {
    sim.stop();
    for (const n of instances.values()) {
      n.fx = null;
      n.fy = null;
    }

    const nodes = graph.nodes.map((n) => instance(n, graph.shown[n.id] ?? 3));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: SimLink[] = graph.links.map((l) => ({
      source: byId.get(l.source)!,
      target: byId.get(l.target)!,
      kind: l.kind,
      primary: l.primary
    }));
    current = { nodes, links };

    // Selecting a decision opens the inspector, which covers the right-hand
    // strip of the stage — including where the process spine is supposed to
    // sit. Centre on what is actually visible instead.
    const covered =
      inspectorOpen && !window.matchMedia(NARROW).matches ? INSPECTOR_WIDTH : 0;
    const cx = (width - covered) / 2;
    const cy = height / 2 + 20;
    const place = (node: SimNode, x: number, y: number) => {
      node.fx = x;
      node.fy = y;
      node.x = x;
      node.y = y;
    };
    place(byId.get(decision.id)!, cx, cy);
    for (const l of links.filter((l) => l.kind === 'department')) place(l.target, cx, cy - 170);

    // Sized from the visible stage, not the whole SVG, or the fan runs off
    // the left edge and under the inspector on the right.
    const radius = Math.min(width - covered, height) * 0.33;
    const fan = (subset: SimLink[], from: number, to: number) => {
      subset.forEach((l, i) => {
        const t = subset.length === 1 ? 0.5 : i / (subset.length - 1);
        const angle = from + (to - from) * t;
        place(l.target, cx + Math.cos(angle) * radius * 1.25, cy + Math.sin(angle) * radius);
      });
    };
    fan(links.filter((l) => l.kind === 'system'), Math.PI * 0.78, Math.PI * 1.22);
    fan(links.filter((l) => l.kind === 'process'), -Math.PI * 0.22, Math.PI * 0.22);

    gLink.selectAll('*').remove();
    gNode.selectAll('*').remove();
    gLabel.selectAll('*').remove();

    gLink
      .selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('class', (l) => `dc-link dc-link--${l.kind} is-lit`)
      .attr('stroke', (l) => LINK_COLOUR[l.kind])
      .attr('stroke-width', (l) => (l.primary ? 2 : 1.1))
      .attr('x1', (l) => l.source.x ?? 0)
      .attr('y1', (l) => l.source.y ?? 0)
      .attr('x2', (l) => l.target.x ?? 0)
      .attr('y2', (l) => l.target.y ?? 0);

    const entered = gNode
      .selectAll<SVGGElement, SimNode>('g.dc-node')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'dc-node')
      .attr('transform', (n) => `translate(${n.x ?? 0},${n.y ?? 0})`)
      .on('click', (event: MouseEvent, n) => {
        event.stopPropagation();
        if (isDecision(n)) return;
        handlers.current.onSelect(n);
      });
    entered.append('path').attr('class', 'dc-halo');
    entered.append('path').attr('class', 'dc-shape');
    paintNodes(entered);

    gLabel
      .selectAll('text')
      .data(nodes.filter((n) => !isDecision(n)))
      .enter()
      .append('text')
      .attr('class', 'dc-hublabel')
      .attr('text-anchor', 'middle')
      .attr('x', (n) => n.x ?? 0)
      .attr('y', (n) => (n.y ?? 0) - nodeRadius(n, n.shown) - 9)
      .text((n) => n.label);

    const centre = gLabel
      .append('text')
      .attr('class', 'dc-declabel dc-centrelabel')
      .attr('text-anchor', 'middle');
    wrapLabel(decision.label).forEach((line, i) => {
      centre
        .append('tspan')
        .attr('x', cx)
        .attr('y', cy + 34 + i * 17)
        .text(line);
    });

    svg.transition().duration(400).call(zoomBehaviour.transform, zoomIdentity);
  }

  function apply(
    graph: ConstellationGraph,
    focus: DecisionNode | null,
    inspecting: boolean
  ) {
    if (!measure()) {
      // The stage has no size until its tab is shown. The observer below
      // replays this the moment it does.
      pending = { graph, focus, inspectorOpen: inspecting };
      return;
    }
    pending = null;
    started = true;
    inspectorOpen = inspecting;
    const leavingFocus = focused && !focus;
    focused = focus;
    if (focus) {
      renderFocus(focus, graph);
      return;
    }
    if (leavingFocus) {
      gLink.selectAll('*').remove();
      gNode.selectAll('*').remove();
      gLabel.selectAll('*').remove();
    }
    renderForce(graph);
  }

  const observer = new ResizeObserver(() => {
    if (!measure()) return;
    if (pending) {
      const next = pending;
      apply(next.graph, next.focus, next.inspectorOpen);
      return;
    }
    if (started && !focused) sim.alpha(0.3).restart();
  });
  observer.observe(stageEl);

  return {
    apply,
    destroy() {
      observer.disconnect();
      sim.stop();
      svg.on('.zoom', null).selectAll('*').remove();
    }
  };
}
