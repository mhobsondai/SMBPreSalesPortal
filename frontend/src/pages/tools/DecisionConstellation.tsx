import { useEffect, useMemo, useState } from 'react';

import { TopBar } from '../../components/TopBar';
import {
  BAND_COLOUR,
  BAND_ORDER,
  CONSTELLATION_DATA,
  DEFAULT_BANDS,
  KIND_LABEL,
  MAX_PRIORITY_FILTER,
  PROCESS,
  TYPE_COLOUR
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
  summarise,
  type FilterState
} from '../../lib/constellation/decisionConstellation';
import {
  isDecision,
  type Band,
  type ConstellationNode,
  type DecisionNode,
  type LinkKind
} from '../../lib/constellation/types';
import { ConstellationCanvas } from './ConstellationCanvas';
import './DecisionConstellation.css';

type Tab = 'idea' | 'business' | 'flexibility' | 'map';

const TABS: { id: Tab; label: string }[] = [
  { id: 'idea', label: 'The idea' },
  { id: 'business', label: 'Example business' },
  { id: 'flexibility', label: 'Flexibility' },
  { id: 'map', label: 'Constellation' }
];

const HUB_KIND_LABEL: Record<Exclude<ConstellationNode['type'], 'decision'>, string> = {
  system: 'Source system',
  process: 'Process spine',
  department: 'Department'
};

const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600' +
  '&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap';

/**
 * Requests the prototype's three fonts when the tool opens. They are no use
 * to the rest of the portal, so they do not belong in `index.html`.
 *
 * **A `<link>` and deliberately not an `@import` in the stylesheet.** An
 * `@import` that cannot be fetched fails the whole lazily-loaded CSS chunk,
 * Vite's preload helper rejects, and the tool renders as a blank page — not
 * as unstyled text. Reproduced by blocking `fonts.googleapis.com`, which is
 * exactly what a locked-down client network does, and this is a tool people
 * open in front of clients. A `<link>` that fails falls back to Arial Narrow
 * and system-ui and everything still works.
 */
function useConstellationFonts() {
  useEffect(() => {
    if (document.getElementById('dc-fonts')) return;
    const link = document.createElement('link');
    link.id = 'dc-fonts';
    link.rel = 'stylesheet';
    link.href = FONT_HREF;
    document.head.appendChild(link);
  }, []);
}

/**
 * Decision Constellation.
 *
 * A pre-sales conversation piece: an inventory of business decisions, each
 * carrying the metadata that turns a list into an architecture, drawn as a
 * network out to the departments that own them, the process spines they sit
 * in and the systems that hold their evidence.
 *
 * Everything in it is a worked example on a hypothetical distributor. There
 * is no client data here and nothing is uploaded, stored or scored — the
 * dataset ships with the app and the page only filters it. The standing
 * notice on the page says so, and it has to stay accurate: see the header
 * comment on `config/decisionConstellationModel.ts` before swapping the
 * dataset for a real client's.
 *
 * **This tool keeps the prototype's own look rather than the portal's.** It
 * is wired in like any other tool — route, tile, auth, tests — but below the
 * portal's top bar it renders as the standalone artefact did: its own brand
 * bar, its own tabs, its own palette and type. That is deliberate and
 * temporary; the header comment on `DecisionConstellation.css` says what
 * restyling it would touch. See AD-18.
 */
export function DecisionConstellation() {
  useConstellationFonts();

  const [tab, setTab] = useState<Tab>('idea');

  const index = useMemo(() => buildIndex(CONSTELLATION_DATA), []);
  const defaults = useMemo(() => defaultFilterState(index, DEFAULT_BANDS), [index]);

  const [bands, setBands] = useState<ReadonlySet<Band>>(defaults.bands);
  const [departments, setDepartments] = useState<ReadonlySet<string>>(defaults.departments);
  const [spines, setSpines] = useState<ReadonlySet<string>>(defaults.spines);
  const [systems, setSystems] = useState<ReadonlySet<string>>(defaults.systems);
  const [kinds, setKinds] = useState<ReadonlySet<LinkKind>>(defaults.kinds);
  const [minPriority, setMinPriority] = useState(0);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');

  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const [railOpen, setRailOpen] = useState(false);
  const [focus, setFocus] = useState<DecisionNode | null>(null);
  const [inspected, setInspected] = useState<ConstellationNode | null>(null);
  /**
   * The escape hatch out of the process view without giving up the filter.
   * Selecting one spine switches to the flow, which is right almost always —
   * but sometimes you want that spine's systems and departments as a network,
   * and there is no other way to ask for it. Re-armed whenever the spine
   * selection changes, so the next spine you pick shows its flow again.
   */
  const [procOff, setProcOff] = useState(false);
  const [processOverflow, setProcessOverflow] = useState(false);

  // Typing should not rebuild a 240-node graph per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryInput), 180);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  const filters: FilterState = useMemo(
    () => ({ bands, departments, spines, systems, kinds, minPriority, query }),
    [bands, departments, spines, systems, kinds, minPriority, query]
  );

  const graph = useMemo(
    () => buildGraph(CONSTELLATION_DATA, index, filters),
    [index, filters]
  );
  const focusGraph = useMemo(
    () => (focus ? egoGraph(CONSTELLATION_DATA, focus.id) : null),
    [focus]
  );

  // One spine and no ego view means the flow, not the network.
  const processSpine = activeProcessSpine(filters);
  const process = useMemo(
    () =>
      processSpine && !procOff && !focus
        ? buildProcessLayout(CONSTELLATION_DATA, index, filters, PROCESS)
        : null,
    [processSpine, procOff, focus, index, filters]
  );
  const summary = useMemo(
    () => summarise(index, filters, focusGraph ?? graph, focus?.id),
    [index, filters, graph, focusGraph, focus]
  );

  const hubDecisions = useMemo(
    () =>
      inspected && !isDecision(inspected)
        ? decisionsForHub(CONSTELLATION_DATA, index, inspected.id)
        : [],
    [inspected, index]
  );

  // Any filter change drops the ego view — the decision it was built around
  // may no longer be on the map.
  function clearFocus() {
    setFocus(null);
  }

  function toggle<T>(set: ReadonlySet<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  function selectNode(node: ConstellationNode) {
    // A process hub is not worth a panel listing what depends on it — the
    // whole flow is one click away and says more.
    if (node.type === 'process') {
      showProcess(node.label);
      return;
    }
    setInspected(node);
    // In the process view a decision opens its panel in place. Dropping the
    // flow for an ego view would lose the position the user just clicked.
    setFocus(!process && isDecision(node) ? node : null);
  }

  /** Isolate one spine and show its flow. */
  function showProcess(spine: string) {
    setSpines(new Set([spine]));
    setProcOff(false);
    setFocus(null);
    setInspected(null);
  }

  function closeInspector() {
    setInspected(null);
    setFocus(null);
  }

  /** Leave the flow for the network, keeping the spine filter. */
  function leaveProcess() {
    setProcOff(true);
    setInspected(null);
  }

  // Escape backs out of the panel wherever you are.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') closeInspector();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function resetFilters() {
    setBands(new Set(DEFAULT_BANDS));
    setDepartments(new Set(index.departments));
    setSpines(new Set(index.spines));
    setSystems(new Set(index.systems.map((s) => s.id)));
    setKinds(new Set<LinkKind>(['system', 'department', 'process']));
    setMinPriority(0);
    setQueryInput('');
    setQuery('');
    setProcOff(false);
    closeInspector();
  }

  return (
    <>
      <TopBar
        links={[{ label: 'Data & AI', to: '/area/data-ai' }, { label: 'All areas', to: '/' }]}
      />

      <div className="dc-app">
        <header className="dc-topbar">
          <div className="dc-brand">
            <span className="dc-brand-mark">Decision Constellation</span>
            <span className="dc-brand-sub">
              Worked example · B2B importer &amp; distributor
            </span>
          </div>
          <nav className="dc-tabs" role="tablist" aria-label="Views">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`dc-tab${tab === t.id ? ' is-active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </header>

        <div className="dc-viewport">
          <IdeaView hidden={tab !== 'idea'} index={index} />
          <BusinessView hidden={tab !== 'business'} />
          <FlexibilityView hidden={tab !== 'flexibility'} />

          {/* Kept mounted so the map does not rebuild every time the user
              flicks back to the prose. The canvas measures itself when the
              stage becomes visible. */}
          <section className="dc-view" hidden={tab !== 'map'} role="tabpanel">
            <div className={`dc-workspace${railOpen ? ' is-rail-open' : ''}`}>
              <button
                type="button"
                className="dc-railtoggle"
                aria-expanded={railOpen}
                onClick={() => setRailOpen((open) => !open)}
              >
                Filters
              </button>

              <aside className="dc-rail">
                <div className="dc-rail-head">
                  <div className="dc-rail-eyebrow">Decision-centric architecture</div>
                  <h2>Filters</h2>
                  <p>
                    Every decision links out to the department that owns it, the systems that
                    hold the evidence, and the process it sits in. Narrow the view, then click
                    any node.
                  </p>
                </div>

                <fieldset className="dc-group">
                  <legend>Priority band</legend>
                  <p className="dc-hint">
                    Value × capability gap × feasibility. Showing Now and Next by default.
                  </p>
                  {BAND_ORDER.map((band) => (
                    <label className="dc-chk" key={band}>
                      <input
                        type="checkbox"
                        checked={bands.has(band)}
                        onChange={() => {
                          setBands(toggle(bands, band));
                          clearFocus();
                        }}
                      />
                      <span className="dc-swatch" style={{ background: BAND_COLOUR[band] }} />
                      {band}
                      <span className="dc-count">{index.bandCounts[band]}</span>
                    </label>
                  ))}
                </fieldset>

                <fieldset className="dc-group">
                  <legend>Department</legend>
                  {index.departments.map((dept) => (
                    <label className="dc-chk" key={dept}>
                      <input
                        type="checkbox"
                        checked={departments.has(dept)}
                        onChange={() => {
                          setDepartments(toggle(departments, dept));
                          clearFocus();
                        }}
                      />
                      {dept}
                      <span className="dc-count">{index.departmentCounts[dept]}</span>
                    </label>
                  ))}
                  <AllNone
                    onAll={() => {
                      setDepartments(new Set(index.departments));
                      clearFocus();
                    }}
                    onNone={() => {
                      setDepartments(new Set());
                      clearFocus();
                    }}
                  />
                </fieldset>

                <fieldset className="dc-group">
                  <legend>Process spine</legend>
                  <p className="dc-hint">
                    Select a single spine to switch into the{' '}
                    <strong className="dc-hint-em">process view</strong> — decisions in
                    flow order, departments as lanes.
                  </p>
                  {index.spines.map((spine) => (
                    <label className="dc-chk" key={spine}>
                      <input
                        type="checkbox"
                        checked={spines.has(spine)}
                        onChange={() => {
                          setSpines(toggle(spines, spine));
                          setProcOff(false);
                          clearFocus();
                        }}
                      />
                      {spine}
                      <span className="dc-count">{index.spineCounts[spine]}</span>
                    </label>
                  ))}
                  <AllNone
                    onAll={() => {
                      setSpines(new Set(index.spines));
                      setProcOff(false);
                      clearFocus();
                    }}
                    onNone={() => {
                      setSpines(new Set());
                      setProcOff(false);
                      clearFocus();
                    }}
                  />
                </fieldset>

                <fieldset className="dc-group">
                  <legend>Source system</legend>
                  <p className="dc-hint">
                    Pick a tier or expand it for single systems. Only decisions drawing on a
                    selected system stay on the map.
                  </p>
                  {index.systemGroups.map((group) => {
                    const ids = group.systems.map((s) => s.id);
                    const on = ids.filter((id) => systems.has(id)).length;
                    const open = openGroups.has(group.name);
                    return (
                      <div className={`dc-sysgroup${open ? ' is-open' : ''}`} key={group.name}>
                        <div className="dc-grphead">
                          <button
                            type="button"
                            className="dc-twist"
                            aria-expanded={open}
                            aria-label={`${open ? 'Collapse' : 'Expand'} ${group.name}`}
                            onClick={() => setOpenGroups(toggle(openGroups, group.name))}
                          >
                            {open ? '▾' : '▸'}
                          </button>
                          <label className="dc-chk dc-chk--group">
                            <input
                              type="checkbox"
                              checked={on === ids.length}
                              ref={(el) => {
                                if (el) el.indeterminate = on > 0 && on < ids.length;
                              }}
                              onChange={(e) => {
                                const next = new Set(systems);
                                for (const id of ids) {
                                  if (e.target.checked) next.add(id);
                                  else next.delete(id);
                                }
                                setSystems(next);
                                clearFocus();
                              }}
                            />
                            {group.name}
                            <span className="dc-count">{ids.length}</span>
                          </label>
                        </div>
                        {open && (
                          <div className="dc-kids">
                            {group.systems.map((system) => (
                              <label className="dc-chk" key={system.id}>
                                <input
                                  type="checkbox"
                                  checked={systems.has(system.id)}
                                  onChange={() => {
                                    setSystems(toggle(systems, system.id));
                                    clearFocus();
                                  }}
                                />
                                {system.label}
                                <span className="dc-count">{system.degree}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <AllNone
                    onAll={() => {
                      setSystems(new Set(index.systems.map((s) => s.id)));
                      clearFocus();
                    }}
                    onNone={() => {
                      setSystems(new Set());
                      clearFocus();
                    }}
                  />
                </fieldset>

                <fieldset className="dc-group">
                  <legend>Show links to</legend>
                  {(['system', 'department', 'process'] as LinkKind[]).map((kind) => (
                    <label className="dc-chk" key={kind}>
                      <input
                        type="checkbox"
                        checked={kinds.has(kind)}
                        onChange={() => {
                          setKinds(toggle(kinds, kind));
                          clearFocus();
                        }}
                      />
                      <span className="dc-swatch" style={{ background: TYPE_COLOUR[kind] }} />
                      {KIND_LABEL[kind]}
                    </label>
                  ))}
                </fieldset>

                <fieldset className="dc-group">
                  <legend>Minimum priority</legend>
                  <input
                    type="range"
                    min={0}
                    max={MAX_PRIORITY_FILTER}
                    step={1}
                    value={minPriority}
                    aria-label="Minimum priority score"
                    onChange={(e) => {
                      setMinPriority(Number(e.target.value));
                      clearFocus();
                    }}
                  />
                  <div className="dc-rangeval">{minPriority} and above</div>
                </fieldset>

                <fieldset className="dc-group dc-group--last">
                  <legend>Find a decision</legend>
                  <input
                    type="search"
                    className="dc-search"
                    placeholder="rebate, landed cost, churn…"
                    aria-label="Search decisions"
                    value={queryInput}
                    onChange={(e) => {
                      setQueryInput(e.target.value);
                      clearFocus();
                    }}
                  />
                  <button type="button" className="dc-mini" onClick={resetFilters}>
                    Reset all filters
                  </button>
                </fieldset>
              </aside>

              <div className={`dc-stage${inspected ? ' is-inspecting' : ''}`}>
                <ConstellationCanvas
                  graph={focusGraph ?? graph}
                  focus={focus}
                  process={process}
                  selectedId={inspected?.id ?? null}
                  inspectorOpen={Boolean(inspected)}
                  onSelect={selectNode}
                  onDismiss={closeInspector}
                  onProcessOverflow={setProcessOverflow}
                />

                {focus && (
                  <div className="dc-focusbar">
                    <span>{focus.id} — systems left, process right</span>
                    <button type="button" onClick={closeInspector}>
                      Back to full map ×
                    </button>
                  </div>
                )}

                {process && (
                  <div className="dc-focusbar">
                    <span>
                      {process.spine} — process view · {process.decisions} decisions
                      {processOverflow ? ' · drag to pan' : ''}
                    </span>
                    <button type="button" onClick={leaveProcess}>
                      Constellation view ×
                    </button>
                  </div>
                )}

                <div className={`dc-legend${process ? ' is-hidden' : ''}`}>
                  <div className="dc-legend-key">Node types</div>
                  <div className="dc-legend-row">
                    <svg viewBox="0 0 14 14" aria-hidden="true">
                      <circle cx="7" cy="7" r="5" fill={BAND_COLOUR.Now} />
                    </svg>
                    Decision
                  </div>
                  <div className="dc-legend-row">
                    <svg viewBox="0 0 14 14" aria-hidden="true">
                      <rect x="2.5" y="2.5" width="9" height="9" fill={TYPE_COLOUR.department} />
                    </svg>
                    Department
                  </div>
                  <div className="dc-legend-row">
                    <svg viewBox="0 0 14 14" aria-hidden="true">
                      <path d="M7 1.5 12.5 7 7 12.5 1.5 7Z" fill={TYPE_COLOUR.system} />
                    </svg>
                    Source system
                  </div>
                  <div className="dc-legend-row">
                    <svg viewBox="0 0 14 14" aria-hidden="true">
                      <path d="M7 1.8 12.2 11.4H1.8Z" fill={TYPE_COLOUR.process} />
                    </svg>
                    Process spine
                  </div>
                </div>

                <div className="dc-titleblock">
                  <div className="dc-tb dc-tb--wide">
                    <div className="dc-tb-k">Sheet</div>
                    <div className="dc-tb-v">{summary.sheet}</div>
                  </div>
                  <div className="dc-tb">
                    <div className="dc-tb-k">Decisions</div>
                    <div className="dc-tb-v">
                      {process ? process.decisions : summary.decisions}
                    </div>
                  </div>
                  {/* The middle two tiles count whatever the current drawing
                      is made of — hubs and links on the map, lanes and stages
                      in the flow. */}
                  <div className="dc-tb">
                    <div className="dc-tb-k">{process ? 'Departments' : 'Systems'}</div>
                    <div className="dc-tb-v">
                      {process ? process.lanes.length : summary.systems}
                    </div>
                  </div>
                  <div className="dc-tb">
                    <div className="dc-tb-k">{process ? 'Stages' : 'Links'}</div>
                    <div className="dc-tb-v">
                      {process ? process.stages.length : summary.links}
                    </div>
                  </div>
                  <div className="dc-tb">
                    <div className="dc-tb-k">Avg priority</div>
                    <div className="dc-tb-v">
                      {process ? process.avgPriority : summary.avgPriority}
                    </div>
                  </div>
                </div>

                <aside
                  className={`dc-inspector${inspected ? ' is-open' : ''}`}
                  aria-live="polite"
                  aria-label="Selected node"
                >
                  {inspected && isDecision(inspected) && (
                    <DecisionPanel
                      decision={inspected}
                      inProcess={Boolean(process)}
                      onClose={closeInspector}
                      onShowProcess={() => showProcess(inspected.spine)}
                    />
                  )}
                  {inspected && !isDecision(inspected) && (
                    <HubPanel
                      hub={inspected}
                      decisions={hubDecisions}
                      onClose={closeInspector}
                      onOnlySystem={() => {
                        setSystems(new Set([inspected.id]));
                        closeInspector();
                      }}
                    />
                  )}
                </aside>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function AllNone({ onAll, onNone }: { onAll: () => void; onNone: () => void }) {
  return (
    <div className="dc-allnone">
      <button type="button" className="dc-mini" onClick={onAll}>
        All
      </button>
      <button type="button" className="dc-mini" onClick={onNone}>
        None
      </button>
    </div>
  );
}

function DecisionPanel({
  decision,
  inProcess,
  onClose,
  onShowProcess
}: {
  decision: DecisionNode;
  inProcess: boolean;
  onClose: () => void;
  onShowProcess: () => void;
}) {
  return (
    <>
      <div className="dc-insp-head">
        <button type="button" className="dc-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <div className="dc-insp-id">
          {decision.id} · {decision.dept}
        </div>
        <h3>{decision.label}</h3>
        <span className="dc-band" style={{ color: BAND_COLOUR[decision.band] }}>
          {decision.band} · {decision.priority}
        </span>
      </div>

      <div className="dc-scores">
        <Score k="Value" v={decision.value.toFixed(2)} />
        <Score k="Gap" v={decision.gap} />
        <Score k="Feasibility" v={decision.feas} />
        <Score k="Revenue" v={decision.rev} />
        <Score k="Cost" v={decision.cost} />
        <Score k="Cash" v={decision.cash} />
      </div>

      <Field k="Owner" v={decision.role} />
      <Field
        k="Cadence"
        v={`${decision.cadence} · ${decision.horizon} · decision needed within ${decision.latency.toLowerCase()}`}
      />
      <div className="dc-field">
        <div className="dc-field-k">Process spine</div>
        <div className="dc-field-v">
          {decision.spine} · stage {decision.stageIndex + 1}, {decision.stage}
        </div>
      </div>
      <div className="dc-field">
        <div className="dc-field-k">Source systems</div>
        <div className="dc-field-v">
          <div className="dc-chips">
            <span className="dc-chip dc-chip--primary">{decision.primary}</span>
            {decision.supporting.map((s) => (
              <span className="dc-chip" key={s}>
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>
      <Field k="How it is decided today" v={decision.tooling} />
      <Field k="Data domains" v={decision.domains} />
      <Field k="Metrics and data needed" v={decision.metrics} />

      <div className="dc-actionbar">
        {/* Already in the flow: the only thing left to do is put the panel
            away. Anywhere else, offer the flow — it is the most useful next
            move from a decision, and otherwise means finding the spine in
            the rail. */}
        {inProcess ? (
          <button type="button" className="dc-act" onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button type="button" className="dc-act" onClick={onShowProcess}>
              Show {decision.spine} in flow
            </button>
            <button
              type="button"
              className="dc-act dc-act--quiet"
              onClick={onClose}
            >
              Back to full map
            </button>
          </>
        )}
      </div>
    </>
  );
}

/**
 * Departments and source systems only. A process spine never reaches here —
 * clicking one goes straight to its flow, which answers the same question
 * better than a list would.
 */
function HubPanel({
  hub,
  decisions,
  onClose,
  onOnlySystem
}: {
  hub: ConstellationNode;
  decisions: DecisionNode[];
  onClose: () => void;
  onOnlySystem: () => void;
}) {
  if (isDecision(hub)) return null;
  const spread = departmentSpreadForHub(decisions);
  return (
    <>
      <div className="dc-insp-head">
        <button type="button" className="dc-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <div className="dc-insp-id">{HUB_KIND_LABEL[hub.type]}</div>
        <h3>{hub.label}</h3>
        <span className="dc-band" style={{ color: TYPE_COLOUR[hub.type] }}>
          {decisions.length} decisions depend on this
        </span>
      </div>

      <div className="dc-field">
        <div className="dc-field-k">Departments touching it</div>
        <div className="dc-field-v">
          <div className="dc-chips">
            {spread.map(([dept, n]) => (
              <span className="dc-chip" key={dept}>
                {dept} · {n}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="dc-field">
        <div className="dc-field-k">Highest-priority decisions</div>
        <div className="dc-field-v">
          {decisions.slice(0, 12).map((d) => (
            <div className="dc-hubrow" key={d.id}>
              <span className="dc-hubrow-pri" style={{ color: BAND_COLOUR[d.band] }}>
                {d.priority}
              </span>
              {d.label}
            </div>
          ))}
        </div>
      </div>

      {hub.type === 'system' && (
        <div className="dc-actionbar">
          <button type="button" className="dc-act" onClick={onOnlySystem}>
            Show only this system
          </button>
        </div>
      )}
    </>
  );
}

function Score({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="dc-score">
      <div className="dc-score-k">{k}</div>
      <div className="dc-score-v">{v}</div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="dc-field">
      <div className="dc-field-k">{k}</div>
      <div className="dc-field-v">{v}</div>
    </div>
  );
}

// ─── Prose views ─────────────────────────────────────────────────────────
//
// Transcribed from the prototype. The wording is the deliverable here as
// much as the map is — it is what a consultant reads out in a first meeting
// — so edit it deliberately rather than tidying it.

function IdeaView({ hidden, index }: { hidden: boolean; index: ReturnType<typeof buildIndex> }) {
  return (
    <section className="dc-view dc-prose" hidden={hidden} role="tabpanel">
      <div className="dc-inner">
        <div className="dc-kicker">What this is for</div>
        <h2>Starting the conversation from decisions, not reports</h2>

        <p className="dc-lead">
          Most data and analytics conversations open with <em>“what reports do you want?”</em> This
          one opens with <em>“what decisions do you make, and how well are they served?”</em>
        </p>

        <p>
          The difference is not cosmetic. A report has no value of its own; a decision does — it
          moves revenue, cost, cash or risk. Asking for reports produces a catalogue, invites the
          client to compare us on day rate, and very often rebuilds what they already have in a
          newer tool.
        </p>

        <p>
          Asking about decisions puts the discussion on their ground and in their language. It
          also surfaces the decisions currently made on instinct, or in an undocumented
          spreadsheet on somebody&apos;s laptop. Those are the best targets we have: there is no
          incumbent tooling to displace, and the client usually already knows they are exposed.
        </p>

        <h3>What the artefact actually is</h3>

        <p>
          An inventory of business decisions, each one carrying the metadata that turns a list
          into an architecture: who owns it, how often it comes up, how fresh the data has to be,
          which end-to-end process it belongs to, which systems hold the evidence, how it is
          decided today, and what it is worth. The network view then draws each decision out to
          its owning department, its process spine and its source systems.
        </p>

        <div className="dc-statrow">
          <Stat n={index.decisions.length} l="Decisions" />
          <Stat n={index.departments.length} l="Departments" />
          <Stat n={index.spines.length} l="Process spines" />
          <Stat n={index.systems.length} l="Source systems" />
        </div>

        <h4>How decisions are prioritised</h4>

        <p>
          Each decision scores on four impact levers (revenue, cost, cash, risk), on how well it
          is served today, and on how feasible it would be to serve properly. Those combine into a
          single priority:
        </p>

        <div className="dc-callout">
          <p>
            <strong>Priority = value × capability gap × feasibility</strong>
          </p>
          <p>
            Chase the decisions that matter, are badly served today, and are actually fixable with
            data you can get hold of. A high-value decision that is already well served scores low
            — and so does one where the data simply does not exist.
          </p>
        </div>

        <h3>Where it is heading</h3>

        <p>
          The intent is a configurable tool rather than a fixed diagram: a copy per client, with
          their departments, their decisions and their systems. Two additions matter most. First,
          capturing <strong>pains and their implications</strong> against each decision, in the
          client&apos;s own words — that is what turns a scored list into a business case. Second,
          decomposing the metrics into <strong>facts and dimensions</strong>, which gives
          consultants a solution-design starting point and gives us the sizing drivers for a
          quote.
        </p>

        <div className="dc-fin">
          <p>
            <strong>Status, honestly stated.</strong> Everything here is built on a hypothetical
            business — there is no client data in it. The scores are first-pass estimates by way
            of illustration, and are deliberately pessimistic: nothing is assumed to be well
            served. In a real engagement the scores are the <em>output</em> of a workshop, not an
            input to it. The frame is the deliverable; the numbers are placeholders.
          </p>
        </div>
      </div>
    </section>
  );
}

function BusinessView({ hidden }: { hidden: boolean }) {
  return (
    <section className="dc-view dc-prose" hidden={hidden} role="tabpanel">
      <div className="dc-inner">
        <div className="dc-kicker">The worked example</div>
        <h2>A £30–60m B2B importer and distributor</h2>

        <p className="dc-lead">
          A hypothetical business, chosen because it lets us build a complete worked example with
          no client data in it — and because the shape recurs constantly in our pipeline.
        </p>

        <table className="dc-table">
          <thead>
            <tr>
              <th>Attribute</th>
              <th>Assumption</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Sector and scale</td>
              <td>B2B trade distribution, £30–60m revenue, UK, single trading entity</td>
            </tr>
            <tr>
              <td>Sourcing</td>
              <td>Imports finished goods from overseas suppliers</td>
            </tr>
            <tr>
              <td>Route to market</td>
              <td>Direct sales force plus a B2B ecommerce portal</td>
            </tr>
            <tr>
              <td>Service model</td>
              <td>
                Supply and account management only — no installation, commissioning or field
                service
              </td>
            </tr>
            <tr>
              <td>Warehousing</td>
              <td>Single distribution centre, picked and packed in house</td>
            </tr>
            <tr>
              <td>Delivery</td>
              <td>
                Third-party parcel and pallet carrier contract. No own fleet, no significant 3PL
              </td>
            </tr>
            <tr>
              <td>Product</td>
              <td>
                Predominantly factored third-party brands, with a growing own-brand range
              </td>
            </tr>
          </tbody>
        </table>

        <h4>Assumed system estate</h4>
        <p>
          Typical for the size rather than confirmed: ERP, CRM, WMS, PIM, B2B ecommerce, EDI
          gateway, carrier and forwarder portals, a customs broker platform, service desk, HRIS
          and time &amp; attendance, marketing automation, treasury — and a very large,
          undocumented volume of Excel.
        </p>

        <h3>Three things the example exposes</h3>

        <h4>1. The ERP is the de facto decision substrate</h4>
        <p>
          It is attached to <strong>150 of the 179 decisions</strong>. The next largest are CRM
          (56), WMS (49) and PIM (33), then a long tail. Anything that improves the
          trustworthiness and accessibility of ERP-derived data therefore lifts a very large
          number of decisions at once — which is the argument for a semantic layer over a series
          of point solutions.
        </p>

        <h4>2. The value sits in the joins, not in any one system</h4>
        <p>
          Because the ERP is so dominant, the decisions that <em>cannot</em> be answered from it
          alone are precisely the ones that score highest: cost-to-serve, S&amp;OP, landed cost,
          margin leakage. Every one of them needs ERP joined to WMS, carrier and customs data.
          That is a point worth making early in any conversation, because it is the part a client
          cannot solve by upgrading a single application.
        </p>

        <h4>3. There is a shadow estate, and it is where the money is</h4>
        <p>
          Roughly a dozen recurring artefacts are the real system of record for consequential
          decisions: the demand forecast and S&amp;OP pack, the landed cost model, the annual
          price file build, customer profitability and cost-to-serve, rebate accrual, commission
          calculation, stock provisioning, freight rate comparison, the budget and reforecast
          model, container fill planning, the credit limit review sheet, and the board pack
          itself. All spreadsheets. No incumbent tooling to displace.
        </p>

        <div className="dc-callout">
          <p>
            <strong>The profile is a dial, not a fixture.</strong> Departments here are
            archetypal — a real distributor of this size may fold Pricing into Commercial, or have
            no Category function at all. Change the profile and roughly twenty decisions change
            with it. That is the point of building it as a configurable template rather than a
            fixed document.
          </p>
        </div>
      </div>
    </section>
  );
}

function FlexibilityView({ hidden }: { hidden: boolean }) {
  return (
    <section className="dc-view dc-prose" hidden={hidden} role="tabpanel">
      <div className="dc-inner">
        <div className="dc-kicker">Why this is worth building on</div>
        <h2>It does not need to be finished to be useful</h2>

        <p className="dc-lead">
          The real value here is not the 179 decisions. It is that the model is additive — you can
          enter it from wherever the opportunity actually starts, build it in small stages over
          months, and have something usable at the end of every stage.
        </p>

        <h3>Five ways in</h3>

        <p>
          Every one of these is a legitimate starting point, and none of them requires the others
          to exist first.
        </p>

        <div className="dc-cards">
          <Card
            t="A single department"
            tag="~1 hour · lowest commitment"
            body="“Let's just map Pricing.” Eleven decisions, an hour of conversation, and a scored list the client recognises immediately. Small enough to do speculatively."
          />
          <Card
            t="A process spine"
            tag="Cross-functional story"
            body="Quote-to-cash carries 51 decisions across eight departments. Select it alone and the map becomes a process view — decisions in flow order, departments as lanes, handoffs visible."
          />
          <Card
            t="A system"
            tag="ERP & systems projects"
            body="“You are replacing the ERP.” Filter to it and 150 decisions light up. Immediately relevant to a programme the client has already funded."
          />
          <Card
            t="A priority band"
            tag="Fastest to a proposal"
            body="Skip straight to the fourteen highest-scoring decisions and work only on those. Shortest route from conversation to business case."
          />
          <Card
            t="A pain"
            tag="Client-led discovery"
            body="Start from what the client volunteers is broken, and work backwards to the decisions it degrades and the data behind them. Their agenda, our structure."
          />
        </div>

        <h3>Build it in stages, over time</h3>

        <p>Nothing about this requires completeness to function:</p>

        <ul>
          <li>
            <strong>One decision is a valid artefact.</strong> So is twenty. So is 179. There is
            no threshold below which the model stops working.
          </li>
          <li>
            <strong>Scoring is relative to what you have.</strong> Priority ranks decisions
            against each other, so the bands are meaningful whether the inventory holds twenty
            rows or two hundred. Adding decisions later re-ranks; it does not invalidate.
          </li>
          <li>
            <strong>Stages can be weeks or months apart.</strong> Each one leaves behind something
            you can put in front of a client — a department view, a spine, a scored shortlist.
          </li>
          <li>
            <strong>Sequencing decides itself.</strong> Whatever lands in the top band is phase
            one. That holds at any size of inventory, which means the roadmap is a by-product
            rather than a separate exercise.
          </li>
        </ul>

        <h3>The systems perspective — ERP projects in particular</h3>

        <p>
          This is the entry point I would push hardest, because it attaches to programmes clients
          have already committed budget to.
        </p>

        <p>
          ERP selection and replacement projects are almost always specified as a functional
          requirements list: what the system must <em>do</em>. That list is long, hard to
          prioritise, and says nothing about what the business will be able to <em>decide</em>{' '}
          afterwards. Reframing it as decisions changes four things:
        </p>

        <ul>
          <li>
            <strong>Requirements gain a rationale.</strong> Each requirement traces to a decision,
            the evidence that decision needs, and the latency it needs it at. “Why are we paying
            for this module?” has an answer that a finance director accepts.
          </li>
          <li>
            <strong>Regression becomes visible.</strong> If 150 decisions currently depend on the
            incumbent ERP, that is a checklist of what must not get worse on cutover. Clients
            rarely have this, and they feel the absence of it.
          </li>
          <li>
            <strong>Day-two analytics scope surfaces early.</strong> Filter the ERP out of the
            picture and look at what is left standing: the decisions needing WMS, carrier, customs
            and Excel joined together. The ERP will not serve those on its own, whoever supplies
            it — and that is precisely where our work sits.
          </li>
          <li>
            <strong>It sequences the wider programme.</strong> Decisions the new platform serves
            on day one, decisions needing the semantic layer after it, decisions that need master
            data fixed first. Three phases, argued from the client&apos;s own priorities.
          </li>
        </ul>

        <div className="dc-callout">
          <p>
            <strong>Two things to try in the Constellation tab.</strong>
          </p>
          <p>
            Open the Source system panel, select Core platforms only, then untick ERP. What
            remains on screen is the part of the business the ERP cannot answer by itself —
            usually the most persuasive ninety seconds of a first meeting.
          </p>
          <p>
            Then select a single process spine. The view switches to{' '}
            <strong>flow order</strong> — stages left to right, departments as lanes. Walking
            one spine stage by stage is the most natural way to run a discovery session,
            because it follows the order in which the business actually makes its decisions.
          </p>
        </div>

        <h3>Why it is safe to start small</h3>

        <p>
          There is no tooling commitment, no data project and no integration work required to
          begin — the artefact is a structured conversation, not a build. That makes it usable at
          the stage where a client will not yet fund anything: it costs an hour of somebody&apos;s
          time, and it produces something they want to keep. It also survives being wrong. Scores
          are explicitly provisional, so a client correcting us is the process working rather than
          a credibility problem.
        </p>

        <div className="dc-fin">
          <p>
            The example inventory is a starting template, not a finding — a real client&apos;s map
            will differ in departments, decisions and scoring, and should. Happy to walk anyone
            through it, or to run the first department live on a real opportunity.
          </p>
        </div>
      </div>
    </section>
  );
}

function Stat({ n, l }: { n: number; l: string }) {
  return (
    <div className="dc-stat">
      <div className="dc-stat-n">{n}</div>
      <div className="dc-stat-l">{l}</div>
    </div>
  );
}

function Card({ t, body, tag }: { t: string; body: string; tag: string }) {
  return (
    <div className="dc-card">
      <div className="dc-card-t">{t}</div>
      <p>{body}</p>
      <span className="dc-card-tag">{tag}</span>
    </div>
  );
}
