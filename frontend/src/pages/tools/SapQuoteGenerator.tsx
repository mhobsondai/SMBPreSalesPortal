import { Fragment, useMemo, useState, type ReactNode } from 'react';

import { TopBar } from '../../components/TopBar';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { resolvePath } from '../../config/navigation';
import { APP_VERSION } from '../../config/app';
import {
  CONVERSION_SCOPE_IDS,
  HOURS_PER_DAY,
  PM_LEVELS,
  PM_CONTINGENCY_CODE,
  PRICING_BASES,
  PRODUCT_STACK_NAMES,
  PROJECT_TYPES,
  SCOPE_CATEGORIES,
  type PmLevelId,
  type PricingBasis,
  type ProjectType,
  type ScopeCategoryId
} from '../../config/sapQuoteGeneratorModel';
import {
  computeTotals,
  costedPhases,
  createBlankQuote,
  fillProduct,
  formatHours,
  formatMoney,
  formatPercent,
  normaliseHours,
  outputFilename,
  pmLevelOf,
  summaryLines,
  warnings,
  withConversionExtras,
  withProductStack,
  withProjectType,
  type QuoteState
} from '../../lib/quoting/sapQuoteGenerator';
import {
  loadBundledChecklistTemplate,
  loadBundledLabmatTemplate
} from '../../lib/quoting/templates';
import '../../styles/tool.css';
import './SapQuoteGenerator.css';

const STEPS = [
  { id: 'details', label: 'Project details' },
  { id: 'hours', label: 'Product hours' },
  { id: 'pm', label: 'Project management' },
  { id: 'scope', label: 'Scope' },
  { id: 'terms', label: 'Dependencies & assumptions' },
  { id: 'review', label: 'Review & generate' }
] as const;

type StepId = (typeof STEPS)[number]['id'];

interface TemplateOverride {
  name: string;
  bytes: ArrayBuffer;
}

/**
 * SAP BI Platform Quote Generator.
 *
 * Rebuilt from the standalone `bobj_generator.html` prototype. Enter hours
 * against the product catalogue, pick or accept a PM tier, confirm the
 * scope, and produce the house-style LabMat and CheckList.
 *
 * Runs entirely in the browser: both documents are assembled client-side, so
 * the client name and contact details never reach a Codestone server. See
 * AD-14.
 */
export function SapQuoteGenerator() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [state, setState] = useState<QuoteState>(() => createBlankQuote(today));
  const [step, setStep] = useState<StepId>('details');
  const [labmatOverride, setLabmatOverride] = useState<TemplateOverride>();
  const [checklistOverride, setChecklistOverride] = useState<TemplateOverride>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string }>();
  const [copied, setCopied] = useState(false);

  const trail = resolvePath(['data-ai'])?.trail ?? [];
  const totals = useMemo(() => computeTotals(state), [state]);
  const notes = useMemo(() => warnings(state, totals), [state, totals]);
  const summary = useMemo(() => summaryLines(state, totals), [state, totals]);
  const costed = useMemo(() => costedPhases(totals.phases), [totals]);

  const patch = (changes: Partial<QuoteState>) =>
    setState((prev) => ({ ...prev, ...changes }));

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  function stepState(id: StepId): 'complete' | 'partial' | 'empty' {
    switch (id) {
      case 'details':
        return state.client.trim() && state.solutionArchitect.trim()
          ? 'complete'
          : state.client.trim() || state.solutionArchitect.trim()
            ? 'partial'
            : 'empty';
      case 'hours':
        return totals.isEmpty ? 'empty' : 'complete';
      case 'pm':
        return totals.pmHours > 0 ? 'complete' : 'empty';
      case 'scope':
        return Object.values(state.inScope).some(Boolean) ? 'complete' : 'empty';
      case 'terms':
        return state.dependencies.length > 0 && state.assumptions.length > 0
          ? 'complete'
          : 'partial';
      case 'review':
        return totals.isEmpty ? 'empty' : 'partial';
    }
  }

  async function pickTemplate(
    kind: 'labmat' | 'checklist',
    file: File | undefined
  ) {
    if (!file) return;
    const bytes = await file.arrayBuffer();
    const override = { name: file.name, bytes };
    if (kind === 'labmat') setLabmatOverride(override);
    else setChecklistOverride(override);
  }

  function download(bytes: ArrayBuffer, filename: string, mime: string) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function generate() {
    setBusy(true);
    setMessage(undefined);
    try {
      // Both writers and their dependencies are dynamically imported, so
      // `exceljs` and `jszip` stay out of the main bundle. See AD-12.
      const [{ buildLabmat }, { buildChecklist }] = await Promise.all([
        import('../../lib/quoting/sapQuoteLabmat'),
        import('../../lib/quoting/sapQuoteChecklist')
      ]);

      const labmatTemplate =
        labmatOverride?.bytes ?? (await loadBundledLabmatTemplate());
      const checklistTemplate =
        checklistOverride?.bytes ?? (await loadBundledChecklistTemplate());

      const labmat = await buildLabmat(labmatTemplate, state, totals);
      download(
        labmat,
        outputFilename(state, 'LabMat', 'xlsx'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );

      const checklist = await buildChecklist(checklistTemplate, state, totals);
      download(
        checklist,
        outputFilename(state, 'CheckList', 'docx'),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );

      setMessage({ kind: 'ok', text: 'LabMat and CheckList downloaded.' });
    } catch (error) {
      setMessage({
        kind: 'err',
        text: error instanceof Error ? error.message : 'Could not generate the documents.'
      });
    }
    setBusy(false);
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

  function changeProjectType(type: ProjectType) {
    const dirty =
      state.dependencies.length > 0 || Object.values(state.inScope).some(Boolean);
    if (
      dirty &&
      !window.confirm(
        'Changing the project type resets the scope, dependencies, assumptions and exclusions to that route’s defaults. Any edits to those lists will be lost. Continue?'
      )
    ) {
      return;
    }
    setState((prev) => withProjectType(prev, type));
  }

  return (
    <>
      <TopBar
        links={[
          { label: 'Data & AI', to: '/area/data-ai' },
          { label: 'All areas', to: '/' }
        ]}
      />

      <main className="page">
        <Breadcrumbs trail={trail} tail="Quote Generator" />

        <section className="tool-header reveal reveal-1">
          <div>
            <div className="eyebrow">SAP BI Platform</div>
            <h1 className="display">
              Quote <em>Generator</em>
            </h1>
            <p className="lede">
              Enter effort against the SAP BIA product catalogue to produce a
              costed LabMat and a matching scope CheckList in house style.
            </p>
          </div>
          <div className="tool-header-meta">
            <div>
              <strong>{formatHours(totals.grandDays)}</strong> days
            </div>
            <div>
              <strong>£{formatMoney(totals.grandValue)}</strong> total
            </div>
            <div>
              <strong>{APP_VERSION}</strong>
            </div>
          </div>
        </section>

        <div className="notice notice--info">
          Runs entirely in this browser. Nothing entered here is uploaded, and a
          refresh clears the quote — finish it in one sitting, or generate the
          documents and keep those.
        </div>

        <div className="tool-split">
          <nav className="tool-rail" aria-label="Quote steps">
            <div className="tool-rail-section">Steps</div>
            {STEPS.map((s, i) => {
              const marker = stepState(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`tool-rail-item ${step === s.id ? 'is-active' : ''}`}
                  onClick={() => setStep(s.id)}
                >
                  <span className="step-number">{i + 1}</span>
                  <span>{s.label}</span>
                  <span
                    className={`tool-rail-dot ${
                      marker === 'complete'
                        ? 'is-complete'
                        : marker === 'partial'
                          ? 'is-partial'
                          : ''
                    }`}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </nav>

          <div>
            {notes.length > 0 && (
              <div className="panel warn-panel">
                <h3 className="panel-title">Points to check</h3>
                <ul className="warn-list">
                  {notes.map((note) => (
                    <li key={note.id}>{note.text}</li>
                  ))}
                </ul>
              </div>
            )}

            {step === 'details' && (
              <DetailsStep
                state={state}
                patch={patch}
                onProjectType={changeProjectType}
                onProductStack={(stack) =>
                  setState((prev) => withProductStack(prev, stack))
                }
              />
            )}

            {step === 'hours' && (
              <HoursStep state={state} totals={totals} patch={patch} />
            )}

            {step === 'pm' && <PmStep state={state} totals={totals} patch={patch} />}

            {step === 'scope' && <ScopeStep state={state} patch={patch} />}

            {step === 'terms' && (
              <TermsStep
                state={state}
                patch={patch}
                onAddConversion={() => setState(withConversionExtras)}
              />
            )}

            {step === 'review' && (
              <ReviewStep
                state={state}
                totals={totals}
                costed={costed}
                summary={summary}
                copied={copied}
                onCopy={copySummary}
                busy={busy}
                message={message}
                labmatName={labmatOverride?.name}
                checklistName={checklistOverride?.name}
                onPickLabmat={(f) => pickTemplate('labmat', f)}
                onPickChecklist={(f) => pickTemplate('checklist', f)}
                onGenerate={generate}
              />
            )}

            <div className="step-footer">
              <button
                type="button"
                className="btn-ghost"
                disabled={stepIndex === 0}
                onClick={() => setStep(STEPS[stepIndex - 1].id)}
              >
                ← Back
              </button>
              <div className="step-footer-meta">
                {totals.isEmpty
                  ? 'No hours entered yet'
                  : `${formatHours(totals.grandDays)} days · £${formatMoney(totals.grandValue)}`}
              </div>
              <button
                type="button"
                className="btn-ghost"
                disabled={stepIndex === STEPS.length - 1}
                onClick={() => setStep(STEPS[stepIndex + 1].id)}
              >
                Next →
              </button>
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

// ─── Step 1: project details ──────────────────────────────────────────

function DetailsStep({
  state,
  patch,
  onProjectType,
  onProductStack
}: {
  state: QuoteState;
  patch: (changes: Partial<QuoteState>) => void;
  onProjectType: (type: ProjectType) => void;
  onProductStack: (stack: string) => void;
}) {
  return (
    <div className="panel">
      <h3 className="panel-title">Project details</h3>
      <p className="panel-note">
        These populate the LabMat header and the CheckList overview table.
      </p>

      <div className="field-grid">
        <Text
          label="Solution architect"
          value={state.solutionArchitect}
          placeholder="e.g. Mike Hobson"
          onChange={(solutionArchitect) => patch({ solutionArchitect })}
        />
        <Field label="Date">
          <input
            type="date"
            className="field-input"
            value={state.projectDate}
            onChange={(e) => patch({ projectDate: e.target.value })}
          />
        </Field>
        <Text
          label="Ticket reference"
          value={state.ticket}
          placeholder="e.g. 2437170"
          onChange={(ticket) => patch({ ticket })}
        />
        <Text
          label="Client"
          value={state.client}
          placeholder="Organisation name"
          onChange={(client) => patch({ client })}
        />
        <Text
          label="Contact name"
          value={state.contactName}
          hint="Goes into the CheckList overview table. Stays in this browser."
          onChange={(contactName) => patch({ contactName })}
        />
        <Text
          label="Contact email"
          value={state.contactEmail}
          onChange={(contactEmail) => patch({ contactEmail })}
        />
      </div>

      <Field label="Product">
        <div className="seg">
          {PRODUCT_STACK_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              className={`seg-option ${state.productStack === name ? 'is-selected' : ''}`}
              onClick={() => onProductStack(name)}
            >
              {name}
            </button>
          ))}
        </div>
      </Field>

      <div className="field-grid">
        <Field
          label="Project type"
          hint="Sets the default scope, dependencies, assumptions and exclusions."
        >
          <div className="seg">
            {PROJECT_TYPES.map((type) => (
              <button
                key={type.id}
                type="button"
                className={`seg-option ${state.projectType === type.id ? 'is-selected' : ''}`}
                onClick={() => onProjectType(type.id)}
              >
                {type.label}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="Pricing basis"
          hint="Fixed price carries 20% contingency per phase. Target price carries none."
        >
          <div className="seg">
            {PRICING_BASES.map((basis) => (
              <button
                key={basis}
                type="button"
                className={`seg-option ${state.pricingBasis === basis ? 'is-selected' : ''}`}
                onClick={() => patch({ pricingBasis: basis as PricingBasis })}
              >
                {basis} price
              </button>
            ))}
          </div>
        </Field>
      </div>
    </div>
  );
}

// ─── Step 2: product hours ────────────────────────────────────────────

function HoursStep({
  state,
  totals,
  patch
}: {
  state: QuoteState;
  totals: ReturnType<typeof computeTotals>;
  patch: (changes: Partial<QuoteState>) => void;
}) {
  const setHours = (code: string, raw: string) =>
    patch({ hours: { ...state.hours, [code]: normaliseHours(raw) } });
  const setActivity = (code: string, value: string) =>
    patch({ activity: { ...state.activity, [code]: value } });

  return (
    <div className="panel">
      <div className="panel-head">
        <h3 className="panel-title">Product hours</h3>
        <span className="panel-meta">
          £{formatMoney(totals.dayRate)}/day · {HOURS_PER_DAY}h day ·{' '}
          {formatPercent(totals.contingencyRate)} contingency
        </span>
      </div>
      <p className="panel-note">
        Every product in the catalogue is enterable. Contingency lines are
        derived from their phase and cannot be typed.
      </p>

      {totals.phases.map((phase) => (
        <div className="phase" key={phase.name}>
          <div className="phase-head">
            <span className="phase-name">{phase.name}</span>
            <span className="phase-figure">
              {phase.hours > 0 ? `${formatHours(phase.hours)}h` : '–'}
            </span>
            <span className="phase-figure">
              {phase.days > 0 ? `${phase.days.toFixed(2)}d` : '–'}
            </span>
            <span className="phase-figure">
              {phase.value > 0 ? `£${formatMoney(phase.value)}` : '–'}
            </span>
          </div>

          {phase.lines.map((line) => (
            <div
              className={`hours-row ${line.hours > 0 ? 'is-costed' : ''} ${
                line.isContingency ? 'is-contingency' : ''
              }`}
              key={line.code}
            >
              <div>
                <div className="hours-desc">{line.description}</div>
                <div className="hours-code">{line.code}</div>
              </div>

              {line.isContingency ? (
                <span className="hours-derived">Derived</span>
              ) : (
                <input
                  type="text"
                  className="hours-activity"
                  placeholder="Activity note…"
                  value={state.activity[line.code] ?? ''}
                  aria-label={`Activity note — ${line.description}`}
                  onChange={(e) => setActivity(line.code, e.target.value)}
                />
              )}

              {line.isContingency ? (
                <span className="hours-input-cell">{formatHours(line.hours)}</span>
              ) : (
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  className="hours-input"
                  placeholder="0"
                  value={state.hours[line.code] || ''}
                  aria-label={`Hours — ${line.description}`}
                  onChange={(e) => setHours(line.code, e.target.value)}
                />
              )}

              <span className="hours-figure">
                {line.hours > 0 ? line.days.toFixed(2) : '–'}
              </span>
              <span className="hours-figure">
                {line.hours > 0 ? `£${formatMoney(line.value)}` : '–'}
              </span>
            </div>
          ))}
        </div>
      ))}

      <div className="impl-total">
        <span>Implementation total</span>
        <span>{formatHours(totals.implementationHours)}h</span>
        <span>{formatHours(totals.implementationDays)}d</span>
        <span>£{formatMoney(totals.implementationValue)}</span>
      </div>
    </div>
  );
}

// ─── Step 3: project management ───────────────────────────────────────

function PmStep({
  state,
  totals,
  patch
}: {
  state: QuoteState;
  totals: ReturnType<typeof computeTotals>;
  patch: (changes: Partial<QuoteState>) => void;
}) {
  const level = pmLevelOf(totals.pmLevel);
  const automatic = !state.pmManual && state.pmRateOverride.trim() === '';

  return (
    <>
      <div className="panel">
        <h3 className="panel-title">Project management</h3>
        <p className="panel-note">
          The tier is selected from the implementation value excluding
          contingency, currently £{formatMoney(totals.baseValue)}. Override
          either the tier or the percentage.
        </p>

        <div className="field-grid">
          <Field label="Tier" hint={automatic ? 'Selected automatically' : 'Manually set'}>
            <select
              className="field-select"
              value={totals.pmLevel}
              onChange={(e) =>
                patch({
                  pmManual: true,
                  pmLevel: e.target.value as PmLevelId,
                  pmRateOverride: ''
                })
              }
            >
              {PM_LEVELS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Rate override"
            hint={`Blank uses the tier rate, currently ${formatPercent(level.rate)}.`}
          >
            <div className="field-suffix">
              <input
                type="number"
                min="0"
                step="0.5"
                className="field-input"
                placeholder="Auto"
                value={state.pmRateOverride}
                onChange={(e) => patch({ pmRateOverride: e.target.value })}
              />
              <span className="field-suffix-unit">%</span>
            </div>
          </Field>
        </div>

        {!automatic && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => patch({ pmManual: false, pmRateOverride: '' })}
          >
            Return to automatic
          </button>
        )}
      </div>

      <div className="panel">
        <h3 className="panel-title">Project management lines</h3>
        <div className="pm-lines">
          <span className="pm-code">{totals.pmProductCode}</span>
          <span>{formatHours(totals.pmHours)}h</span>
          <span>{formatHours(totals.pmDays)}d</span>
          <span className="r">£{formatMoney(totals.pmValue)}</span>

          <span className="pm-code pm-code--derived">{PM_CONTINGENCY_CODE}</span>
          <span>{formatHours(totals.pmContingencyHours)}h</span>
          <span>{formatHours(totals.pmContingencyDays)}d</span>
          <span className="r">£{formatMoney(totals.pmContingencyValue)}</span>

          <span className="pm-total">Project management total</span>
          <span className="pm-total">
            {formatHours(totals.pmHours + totals.pmContingencyHours)}h
          </span>
          <span className="pm-total">
            {formatHours(totals.pmDays + totals.pmContingencyDays)}d
          </span>
          <span className="pm-total r">
            £{formatMoney(totals.pmValue + totals.pmContingencyValue)}
          </span>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">{level.label}</h3>
        <p className="panel-note">
          These deliverables are written into the CheckList inclusions.
        </p>
        <ul className="deliverables">
          {level.deliverables.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </div>

      <div className="grand-strip">
        <div>
          <div className="grand-label">Grand total hours</div>
          <div className="grand-value">{formatHours(totals.grandHours)}</div>
        </div>
        <div>
          <div className="grand-label">Grand total days</div>
          <div className="grand-value">{formatHours(totals.grandDays)}</div>
        </div>
        <div>
          <div className="grand-label">Grand total value</div>
          <div className="grand-value">£{formatMoney(totals.grandValue)}</div>
        </div>
      </div>
    </>
  );
}

// ─── Step 4: scope ────────────────────────────────────────────────────

function ScopeStep({
  state,
  patch
}: {
  state: QuoteState;
  patch: (changes: Partial<QuoteState>) => void;
}) {
  const setCustom = (id: ScopeCategoryId, items: string[]) =>
    patch({ customScope: { ...state.customScope, [id]: items } });

  return (
    <div className="panel">
      <h3 className="panel-title">In scope</h3>
      <p className="panel-note">
        Ticked items become the CheckList inclusions, grouped by category.
        Defaults come from the project type.
      </p>

      {SCOPE_CATEGORIES.map((category) => (
        <div className="scope-cat" key={category.id}>
          <div className="scope-cat-label">{category.label}</div>

          {category.items.map((item) => (
            <label className="check" key={item.id}>
              <input
                type="checkbox"
                checked={Boolean(state.inScope[item.id])}
                onChange={(e) =>
                  patch({ inScope: { ...state.inScope, [item.id]: e.target.checked } })
                }
              />
              <span>
                {fillProduct(item.text, state.productStack)}
                {item.defaultFor.includes(state.projectType) && (
                  <span className="tag">default</span>
                )}
                {CONVERSION_SCOPE_IDS.includes(item.id) && (
                  <span className="tag tag--alt">conversion</span>
                )}
              </span>
            </label>
          ))}

          <EditableList
            items={state.customScope[category.id] ?? []}
            onChange={(items) => setCustom(category.id, items)}
            addLabel="Add custom item"
            placeholder="Custom inclusion…"
            indented
          />
        </div>
      ))}
    </div>
  );
}

// ─── Step 5: dependencies, assumptions, exclusions ────────────────────

function TermsStep({
  state,
  patch,
  onAddConversion
}: {
  state: QuoteState;
  patch: (changes: Partial<QuoteState>) => void;
  onAddConversion: () => void;
}) {
  const conversionSelected = CONVERSION_SCOPE_IDS.some((id) => state.inScope[id]);

  return (
    <>
      {conversionSelected && (
        <div className="panel">
          <div className="panel-head">
            <h3 className="panel-title">Conversion clauses</h3>
            <button type="button" className="btn-primary-ghost" onClick={onAddConversion}>
              Add conversion clauses
            </button>
          </div>
          <p className="panel-note">
            Universe conversion is in scope. These add the matching assumption
            and exclusion for this route, without touching anything else.
          </p>
        </div>
      )}

      <div className="panel">
        <h3 className="panel-title">Dependencies</h3>
        <p className="panel-note">Things that must be true before work starts.</p>
        <EditableList
          items={state.dependencies}
          onChange={(dependencies) => patch({ dependencies })}
          addLabel="Add dependency"
          placeholder="Dependency…"
          multiline
        />
      </div>

      <div className="panel">
        <h3 className="panel-title">Assumptions</h3>
        <p className="panel-note">What the estimate assumes to be the case.</p>
        <EditableList
          items={state.assumptions}
          onChange={(assumptions) => patch({ assumptions })}
          addLabel="Add assumption"
          placeholder="Assumption…"
          multiline
        />
      </div>

      <div className="panel">
        <h3 className="panel-title">Out of scope</h3>
        <p className="panel-note">
          The exclusions section of the CheckList. Worth reading before every
          issue — this is the list that gets quoted back at you.
        </p>
        <EditableList
          items={state.exclusions}
          onChange={(exclusions) => patch({ exclusions })}
          addLabel="Add exclusion"
          placeholder="Exclusion…"
          multiline
        />
      </div>
    </>
  );
}

// ─── Step 6: review and generate ──────────────────────────────────────

function ReviewStep({
  state,
  totals,
  costed,
  summary,
  copied,
  onCopy,
  busy,
  message,
  labmatName,
  checklistName,
  onPickLabmat,
  onPickChecklist,
  onGenerate
}: {
  state: QuoteState;
  totals: ReturnType<typeof computeTotals>;
  costed: ReturnType<typeof costedPhases>;
  summary: string[];
  copied: boolean;
  onCopy: () => void;
  busy: boolean;
  message?: { kind: 'ok' | 'err'; text: string };
  labmatName?: string;
  checklistName?: string;
  onPickLabmat: (file: File | undefined) => void;
  onPickChecklist: (file: File | undefined) => void;
  onGenerate: () => void;
}) {
  return (
    <>
      <div className="panel">
        <h3 className="panel-title">Quote summary</h3>
        <div className="review-grid">
          <Cell label="Product" value={state.productStack} />
          <Cell
            label="Route"
            value={`${state.projectType === 'install' ? 'Installation' : 'Upgrade'} (${state.pricingBasis})`}
          />
          <Cell label="Client" value={state.client || '—'} />
          <Cell label="Ticket" value={state.ticket || '—'} />
          <Cell label="Architect" value={state.solutionArchitect || '—'} />
          <Cell label="Date" value={state.projectDate || '—'} />
        </div>

        <table className="effort-table">
          <thead>
            <tr>
              <th>Phase / line</th>
              <th className="r">Hours</th>
              <th className="r">Days</th>
              <th className="r">Value</th>
            </tr>
          </thead>
          <tbody>
            {costed.map((phase) => (
              <Fragment key={phase.name}>
                <tr className="effort-phase">
                  <td>{phase.name}</td>
                  <td className="r">{formatHours(phase.hours)}</td>
                  <td className="r">{formatHours(phase.days)}</td>
                  <td className="r">£{formatMoney(phase.value)}</td>
                </tr>
                {phase.lines.map((line) => (
                  <tr key={line.code} className={line.isContingency ? 'effort-derived' : ''}>
                    <td className="effort-line">
                      {line.description}
                      {line.isContingency && ' (derived)'}
                    </td>
                    <td className="r">{formatHours(line.hours)}</td>
                    <td className="r">{formatHours(line.days)}</td>
                    <td className="r">£{formatMoney(line.value)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr className="effort-phase">
              <td>{totals.pmLabel}</td>
              <td className="r">{formatHours(totals.pmHours + totals.pmContingencyHours)}</td>
              <td className="r">{formatHours(totals.pmDays + totals.pmContingencyDays)}</td>
              <td className="r">
                £{formatMoney(totals.pmValue + totals.pmContingencyValue)}
              </td>
            </tr>
            <tr className="effort-grand">
              <td>Grand total</td>
              <td className="r">{formatHours(totals.grandHours)}</td>
              <td className="r">{formatHours(totals.grandDays)}</td>
              <td className="r">£{formatMoney(totals.grandValue)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h3 className="panel-title">Templates</h3>
        <p className="panel-note">
          Both house-style templates ship with the tool. Override one only if
          the template has changed and the repo has not caught up.
        </p>
        <div className="template-grid">
          <TemplatePicker
            title="LabMat"
            filename="blank-bia-labmat.xlsx"
            accept=".xlsx"
            override={labmatName}
            onPick={onPickLabmat}
          />
          <TemplatePicker
            title="CheckList"
            filename="blank-checklist.docx"
            accept=".docx"
            override={checklistName}
            onPick={onPickChecklist}
          />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3 className="panel-title">Generate</h3>
          <button type="button" className="btn-ghost" onClick={onCopy}>
            {copied ? 'Copied' : 'Copy summary'}
          </button>
        </div>
        <p className="panel-note">
          The CheckList introduction is left blank in this build — the project
          brief step is not yet wired up. Write it in Word, or wait for the
          generated draft.
        </p>
        <button
          type="button"
          className="btn-primary-ghost generate-btn"
          onClick={onGenerate}
          disabled={busy || totals.isEmpty}
        >
          {busy ? 'Generating…' : 'Download LabMat and CheckList'}
        </button>
        {totals.isEmpty && (
          <p className="panel-note">Enter some hours before generating.</p>
        )}
        {message && (
          <div
            className={`notice ${message.kind === 'ok' ? 'notice--info' : 'notice--warn'} generate-msg`}
          >
            {message.text}
          </div>
        )}
      </div>

      <div className="panel output-panel">
        <h3 className="panel-title">Copy-ready summary</h3>
        <pre className="output-block">{summary.join('\n')}</pre>
      </div>
    </>
  );
}

// ─── Small shared pieces ──────────────────────────────────────────────

function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {hint && <p className="field-hint">{hint}</p>}
      {children}
    </div>
  );
}

function Text({
  label,
  value,
  onChange,
  placeholder,
  hint
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="text"
        className="field-input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="review-cell">
      <div className="review-label">{label}</div>
      <div className="review-value">{value}</div>
    </div>
  );
}

function TemplatePicker({
  title,
  filename,
  accept,
  override,
  onPick
}: {
  title: string;
  filename: string;
  accept: string;
  override?: string;
  onPick: (file: File | undefined) => void;
}) {
  return (
    <label className={`template-card ${override ? 'is-override' : ''}`}>
      <div className="template-title">{title}</div>
      <div className="template-file">{override ?? filename}</div>
      <div className="template-state">
        {override ? 'Overridden for this session' : 'Bundled house style'}
      </div>
      <input
        type="file"
        accept={accept}
        className="template-input"
        onChange={(e) => onPick(e.target.files?.[0])}
      />
    </label>
  );
}

/**
 * An editable list of strings. Blank entries are kept while typing and
 * dropped at render time — deleting the text of a line should not make the
 * row vanish under the cursor.
 */
function EditableList({
  items,
  onChange,
  addLabel,
  placeholder,
  multiline,
  indented
}: {
  items: string[];
  onChange: (items: string[]) => void;
  addLabel: string;
  placeholder: string;
  multiline?: boolean;
  indented?: boolean;
}) {
  const set = (index: number, value: string) =>
    onChange(items.map((item, i) => (i === index ? value : item)));
  const remove = (index: number) => onChange(items.filter((_, i) => i !== index));

  return (
    <div className={indented ? 'list-edit list-edit--indented' : 'list-edit'}>
      {items.map((item, index) => (
        <div className="list-row" key={index}>
          {multiline ? (
            <textarea
              className="field-textarea list-textarea"
              rows={2}
              value={item}
              placeholder={placeholder}
              onChange={(e) => set(index, e.target.value)}
            />
          ) : (
            <input
              type="text"
              className="field-input"
              value={item}
              placeholder={placeholder}
              onChange={(e) => set(index, e.target.value)}
            />
          )}
          <button
            type="button"
            className="list-remove"
            aria-label="Remove"
            onClick={() => remove(index)}
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="btn-ghost" onClick={() => onChange([...items, ''])}>
        + {addLabel}
      </button>
    </div>
  );
}
