import { useEffect, useMemo, useState } from 'react';

import { TopBar } from '../../components/TopBar';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { resolvePath } from '../../config/navigation';
import { APP_VERSION } from '../../config/app';
import {
  MAX_PRODUCTION_ENVIRONMENTS,
  type Field,
  type Guidance,
  type Tab
} from '../../config/sapInstallAssessmentModel';
import {
  CLIENT_TABS,
  ENVIRONMENT_TABS,
  STORAGE_KEY,
  advisories,
  createBlankAssessment,
  deserialise,
  exportFilename,
  installationTypeOf,
  isTabVisible,
  overallCompleteness,
  serialise,
  summaryLines,
  syncEnvironments,
  tabCompleteness,
  toExport,
  visibleFields,
  type AssessmentState,
  type Answers
} from '../../lib/assessments/sapInstallAssessment';
import '../../styles/tool.css';
import './SapInstallAssessment.css';

/** Which pane is showing. `envId` is set only for per-environment tabs. */
interface Location {
  tabId: string;
  envId?: string;
}

const FRONT_TAB_IDS = ['overview', 'usage', 'landscape'];
const TAIL_TAB_IDS = ['training', 'go-live'];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * SAP BI Platform — Pre-Sales Install Assessment.
 *
 * A structured version of `Blank Install Assessment.docx`, reordered so
 * each tab maps to one screen the consultant is looking at, with room
 * beside every question for the screenshot that shows where to find the
 * answer.
 *
 * ## Where the data lives
 *
 * Entirely in the browser, and — unlike the other two tools — **saved to
 * `localStorage`**. This assessment runs to fifteen-plus tabs across
 * several environments, so losing it to an accidental refresh was not
 * acceptable. That is a deliberate departure from AD-09, and because the
 * Overview tab holds named contacts it changes this tool's data-protection
 * posture: see AD-11. There is no API call, and the notice at the top of
 * the page states the position to the user, so it has to stay true.
 */
export function SapInstallAssessment() {
  const [state, setState] = useState<AssessmentState>(() => {
    const restored =
      typeof window === 'undefined'
        ? undefined
        : deserialise(window.localStorage.getItem(STORAGE_KEY));
    return restored ?? createBlankAssessment(today());
  });
  const [restoredNotice, setRestoredNotice] = useState(() => {
    if (typeof window === 'undefined') return false;
    return deserialise(window.localStorage.getItem(STORAGE_KEY)) !== undefined;
  });
  const [location, setLocation] = useState<Location>({ tabId: 'overview' });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const [wordState, setWordState] = useState<'idle' | 'building' | 'failed'>('idle');

  const type = installationTypeOf(state);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, serialise(state));
    } catch {
      /* Quota or private-browsing refusal. The assessment still works for
         this session; silently degrading is better than an alarming error
         mid-conversation. */
    }
  }, [state]);

  const completeness = useMemo(() => overallCompleteness(state), [state]);
  const summary = useMemo(() => summaryLines(state), [state]);

  // Resolve the active pane. An installation-type change can hide the tab
  // the user is standing on, so fall back rather than render nothing.
  const requestedTab = [...CLIENT_TABS, ...ENVIRONMENT_TABS].find(
    (t) => t.id === location.tabId
  );
  const activeTab =
    requestedTab && isTabVisible(requestedTab, type) ? requestedTab : CLIENT_TABS[0];
  const activeEnvironment =
    activeTab.scope === 'environment'
      ? state.environments.find((e) => e.id === location.envId) ?? state.environments[0]
      : undefined;
  const answers: Answers =
    activeTab.scope === 'environment' ? activeEnvironment?.answers ?? {} : state.client;

  // ─── Mutation ───────────────────────────────────────────────────────

  function setClientAnswer(fieldId: string, value: string) {
    setRestoredNotice(false);
    setState((prev) => {
      const next: AssessmentState = {
        ...prev,
        client: { ...prev.client, [fieldId]: value }
      };
      if (fieldId !== 'productionEnvironmentCount') return next;

      const requested = Number.parseInt(value, 10);
      if (!Number.isFinite(requested) || requested < 1) return next;
      const capped = Math.min(requested, MAX_PRODUCTION_ENVIRONMENTS);

      // Shrinking discards answers. Confirm rather than silently binning a
      // completed environment because of a mistyped digit.
      if (capped < prev.environments.length) {
        const losing = prev.environments.slice(capped).map((e) => e.label).join(', ');
        const ok = window.confirm(
          `Reducing to ${capped} production environment${capped === 1 ? '' : 's'} will discard all answers for: ${losing}.\n\nContinue?`
        );
        if (!ok) return prev;
      }
      return syncEnvironments(next, capped);
    });
  }

  function setEnvironmentAnswer(envId: string, fieldId: string, value: string) {
    setRestoredNotice(false);
    setState((prev) => ({
      ...prev,
      environments: prev.environments.map((environment) =>
        environment.id === envId
          ? { ...environment, answers: { ...environment.answers, [fieldId]: value } }
          : environment
      )
    }));
  }

  function renameEnvironment(envId: string, label: string) {
    setState((prev) => ({
      ...prev,
      environments: prev.environments.map((environment) =>
        environment.id === envId ? { ...environment, label } : environment
      )
    }));
  }

  function setAnswer(fieldId: string, value: string) {
    if (activeTab.scope === 'environment' && activeEnvironment) {
      setEnvironmentAnswer(activeEnvironment.id, fieldId, value);
    } else {
      setClientAnswer(fieldId, value);
    }
  }

  function clearAssessment() {
    const ok = window.confirm(
      'Clear this assessment?\n\nEvery answer, including the client and contact details, is deleted from this browser. This cannot be undone.'
    );
    if (!ok) return;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Nothing to recover from — the in-memory reset below still applies. */
    }
    setState(createBlankAssessment(today()));
    setRestoredNotice(false);
    setLocation({ tabId: 'overview' });
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summary.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadJson() {
    saveBlob(
      new Blob([JSON.stringify(toExport(state), null, 2)], { type: 'application/json' }),
      exportFilename(state, 'json')
    );
  }

  /**
   * Word export.
   *
   * The `docx` builder is imported dynamically so it becomes its own chunk —
   * it is roughly the size of the rest of the app, and most page loads never
   * click this button. Generation is in-browser: nothing is uploaded.
   */
  async function downloadWord() {
    setWordState('building');
    try {
      const { assessmentDocxBlob } = await import(
        '../../lib/assessments/sapInstallAssessmentDocx'
      );
      const blob = await assessmentDocxBlob(state, advisories(state));
      saveBlob(blob, exportFilename(state, 'docx'));
      setWordState('idle');
    } catch {
      setWordState('failed');
    }
  }

  // ─── Rail ───────────────────────────────────────────────────────────

  function railDot(tab: Tab, tabAnswers: Answers) {
    const c = tabCompleteness(tab, type, tabAnswers);
    const cls = c.isComplete ? 'is-complete' : c.answered > 0 ? 'is-partial' : '';
    return (
      <span
        className={`tool-rail-dot ${cls}`}
        title={`${c.answered} of ${c.required} answered`}
        aria-hidden="true"
      />
    );
  }

  function clientRailItem(tabId: string) {
    const tab = CLIENT_TABS.find((t) => t.id === tabId);
    if (!tab || !isTabVisible(tab, type)) return null;
    return (
      <button
        key={tab.id}
        type="button"
        className={`tool-rail-item ${activeTab.id === tab.id ? 'is-active' : ''}`}
        onClick={() => setLocation({ tabId: tab.id })}
      >
        <span>{tab.title}</span>
        {railDot(tab, state.client)}
      </button>
    );
  }

  const trail = resolvePath(['data-ai'])?.trail ?? [];
  const visibleEnvironmentTabs = ENVIRONMENT_TABS.filter((t) => isTabVisible(t, type));

  return (
    <>
      <TopBar
        links={[{ label: 'Data & AI', to: '/area/data-ai' }, { label: 'All areas', to: '/' }]}
      />

      <main className="page">
        <Breadcrumbs trail={trail} tail="Pre-Sales Install Assessment" />

        <section className="tool-header reveal reveal-1">
          <div>
            <div className="eyebrow">SAP BI Platform</div>
            <h1 className="display">
              Pre-Sales <em>Install Assessment</em>
            </h1>
            <p className="lede">
              Capture an existing SAP BusinessObjects or Crystal Server estate
              during the technical conversation. Each tab matches one screen
              you will be looking at, with guidance beside it.
            </p>
          </div>
          <div className="tool-header-meta">
            <div>
              <strong>
                {completeness.answered}/{completeness.required}
              </strong>{' '}
              answered
            </div>
            <div>
              <strong>{state.environments.length}</strong> prod env
              {state.environments.length === 1 ? '' : 's'}
            </div>
            <div><strong>{APP_VERSION}</strong></div>
          </div>
        </section>

        <div className="notice notice--data">
          This assessment is saved <strong>in this browser, on this device</strong>{' '}
          so a refresh does not lose your work. Nothing is uploaded and no
          server holds a copy. It includes the contact names and email
          addresses you enter, so clear it once the assessment has been
          written up.
        </div>

        {restoredNotice ? (
          <div className="notice notice--info">
            An assessment in progress was restored from this browser.
          </div>
        ) : null}

        <div className="tool-split">
          <nav className="tool-rail" aria-label="Assessment sections">
            <div className="tool-rail-section">Client</div>
            {FRONT_TAB_IDS.map(clientRailItem)}

            <div className="tool-rail-section">Production environments</div>
            {state.environments.map((environment) => {
              const isCollapsed = collapsed[environment.id] ?? false;
              return (
                <div className="tool-rail-group" key={environment.id}>
                  <button
                    type="button"
                    className="tool-rail-group-head"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((prev) => ({
                        ...prev,
                        [environment.id]: !isCollapsed
                      }))
                    }
                  >
                    <span className="tool-rail-caret" aria-hidden="true">
                      {isCollapsed ? '▶' : '▼'}
                    </span>
                    <span>{environment.label}</span>
                  </button>

                  {isCollapsed
                    ? null
                    : visibleEnvironmentTabs.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          className={`tool-rail-item tool-rail-item--nested ${
                            activeTab.id === tab.id &&
                            activeEnvironment?.id === environment.id
                              ? 'is-active'
                              : ''
                          }`}
                          onClick={() =>
                            setLocation({ tabId: tab.id, envId: environment.id })
                          }
                        >
                          <span>{tab.title}</span>
                          {railDot(tab, environment.answers)}
                        </button>
                      ))}
                </div>
              );
            })}

            <div className="tool-rail-section">Commercial</div>
            {TAIL_TAB_IDS.map(clientRailItem)}
          </nav>

          <div>
            <div className="tool-workspace">
              <div className="panel">
                <div className="pane-head">
                  {activeEnvironment ? (
                    <div className="eyebrow">{activeEnvironment.label}</div>
                  ) : null}
                  <h2 className="panel-title">{activeTab.title}</h2>
                  <p className="panel-note">{activeTab.blurb}</p>
                </div>

                {activeEnvironment && activeTab.id === visibleEnvironmentTabs[0]?.id ? (
                  <div className="field">
                    <label className="field-label" htmlFor="env-label">
                      Environment label
                    </label>
                    <p className="field-hint">
                      Used in the rail and the output — the client&rsquo;s own name
                      for it is usually clearest.
                    </p>
                    <input
                      id="env-label"
                      className="field-input"
                      value={activeEnvironment.label}
                      onChange={(e) =>
                        renameEnvironment(activeEnvironment.id, e.target.value)
                      }
                    />
                  </div>
                ) : null}

                {visibleFields(activeTab, type, answers).map((field) => (
                  <FieldControl
                    key={field.id}
                    field={field}
                    value={answers[field.id] ?? ''}
                    onChange={(value) => setAnswer(field.id, value)}
                  />
                ))}
              </div>

              <GuidancePane guidance={activeTab.guidance} title={activeTab.title} />
            </div>

            <div className="panel output-panel">
              <div className="panel-head">
                <h3 className="panel-title">Assessment record</h3>
                <div className="output-actions">
                  <button
                    type="button"
                    className="btn-primary-ghost"
                    onClick={downloadWord}
                    disabled={wordState === 'building'}
                  >
                    {wordState === 'building' ? 'Building…' : 'Download Word'}
                  </button>
                  <button type="button" className="btn-ghost" onClick={downloadJson}>
                    Download JSON
                  </button>
                  <button type="button" className="btn-ghost" onClick={copySummary}>
                    {copied ? 'Copied' : 'Copy all'}
                  </button>
                </div>
              </div>
              <p className="panel-note">
                The Word file matches the standard assessment document and is
                built here in the browser — nothing is uploaded. The JSON is for
                the SAP Quote Generator. Unanswered fields appear as{' '}
                <code>—</code> below and as empty cells in the document, so gaps
                stay visible.
              </p>

              {wordState === 'failed' ? (
                <div className="notice notice--warn">
                  The Word document could not be built. Use <strong>Copy all</strong>{' '}
                  for now — the text below holds everything.
                </div>
              ) : null}
              <pre className="output-block">{summary.join('\n')}</pre>
            </div>

            <div className="panel">
              <div className="panel-head">
                <h3 className="panel-title">Clear assessment</h3>
                <button type="button" className="btn-ghost btn-danger" onClick={clearAssessment}>
                  Clear assessment
                </button>
              </div>
              <p className="panel-note">
                Deletes every answer from this browser, including the contact
                details. Do this once the assessment has been written up.
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="page-footer">
        SMB Pre-Sales Portal · {APP_VERSION} · Codestone internal use only
      </footer>
    </>
  );
}

// ─── Field rendering ──────────────────────────────────────────────────

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' }
];

function FieldControl({
  field,
  value,
  onChange
}: {
  field: Field;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `field-${field.id}`;

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {field.label}
      </label>
      {field.hint ? <p className="field-hint">{field.hint}</p> : null}
      {renderControl()}
    </div>
  );

  function renderControl() {
    switch (field.kind) {
      case 'yesno':
        return <Segmented id={id} options={YES_NO} value={value} onChange={onChange} />;

      case 'yesnosome':
      case 'select':
      case 'weekday':
        return (
          <select
            id={id}
            className="field-select"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">Select…</option>
            {(field.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        );

      case 'textarea':
        return (
          <textarea
            id={id}
            className="field-textarea"
            value={value}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case 'gb':
        return (
          <div className="field-suffix">
            <input
              id={id}
              type="number"
              min="0"
              step="0.1"
              className="field-input"
              value={value}
              placeholder={field.placeholder ?? '0'}
              onChange={(e) => onChange(e.target.value)}
            />
            <span className="field-suffix-unit">GB</span>
          </div>
        );

      case 'number':
        return (
          <input
            id={id}
            type="number"
            min="0"
            step="1"
            className="field-input"
            value={value}
            placeholder={field.placeholder ?? '0'}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case 'date':
        return (
          <input
            id={id}
            type="date"
            className="field-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case 'email':
        return (
          <input
            id={id}
            type="email"
            className="field-input"
            value={value}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case 'text':
      default:
        return (
          <input
            id={id}
            type="text"
            className="field-input"
            value={value}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        );
    }
  }
}

function Segmented({
  id,
  options,
  value,
  onChange
}: {
  id: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="seg" id={id} role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`seg-option ${value === option.value ? 'is-selected' : ''}`}
          aria-pressed={value === option.value}
          onClick={() => onChange(value === option.value ? '' : option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ─── Guidance ─────────────────────────────────────────────────────────

/**
 * The right-hand half of the workspace.
 *
 * Copy and screenshots are supplied later; until then each declared slot
 * renders a placeholder at its intended aspect ratio so the layout does not
 * shift when the real image arrives.
 */
function GuidancePane({ guidance, title }: { guidance: Guidance; title: string }) {
  const hasContent =
    guidance.intro !== '' || guidance.steps.length > 0 || guidance.images.length > 0;

  return (
    <aside className="guidance-pane" aria-label={`Guidance — ${title}`}>
      <p className="guidance-title">Where to find this</p>

      {!hasContent ? (
        <p className="guidance-empty">
          These questions are answered from the conversation itself, so no
          system guidance is needed.
        </p>
      ) : null}

      {guidance.intro ? <p className="guidance-empty">{guidance.intro}</p> : null}

      {guidance.steps.length > 0 ? (
        <ol className="guidance-steps">
          {guidance.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      ) : null}

      {hasContent && guidance.intro === '' && guidance.steps.length === 0 ? (
        <p className="guidance-empty">Step-by-step guidance to follow.</p>
      ) : null}

      {guidance.images.map((image) => (
        <figure className="guidance-figure" key={image.id}>
          {image.src ? (
            <img src={image.src} alt={image.caption || title} />
          ) : (
            <div className={`guidance-placeholder guidance-placeholder--${image.size}`}>
              {image.id}
            </div>
          )}
          {image.caption ? <figcaption>{image.caption}</figcaption> : null}
        </figure>
      ))}
    </aside>
  );
}
