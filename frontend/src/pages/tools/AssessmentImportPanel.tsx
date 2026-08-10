import { useMemo, useState } from 'react';

import { ApiError, interpretTechnicalStrings } from '../../lib/api';
import {
  allChangeIds,
  buildSeed,
  containsPersonalData,
  interpretLocally,
  needsInterpretation,
  parseAssessmentExport,
  planImport,
  seedSummaryLines,
  technicalStringsFor,
  type ImportGroup,
  type ImportPlan
} from '../../lib/quoting/sapQuoteImport';
import { NEVER_SEEDED_NOTE, type Interpretation } from '../../config/sapQuoteImportModel';
import type { QuoteState } from '../../lib/quoting/sapQuoteGenerator';

const GROUP_LABELS: Record<ImportGroup, string> = {
  identity: 'Client and contact',
  setup: 'Product and route',
  hours: 'Effort',
  scope: 'Scope'
};

interface Props {
  state: QuoteState;
  onApply: (plan: ImportPlan, accepted: Set<string>) => void;
}

/**
 * Paste an install assessment export and pre-populate the quote from it.
 *
 * Three things this panel is careful about, all of them recorded in AD-15:
 *
 * 1. **Nothing is applied without being shown.** The operating-system
 *    reading alone can turn an in-place upgrade into a full install and
 *    migration — a different engagement at a different price — so the
 *    consultant sees a field-by-field diff and ticks what to take.
 *
 * 2. **Personal data does not leave the browser.** The assessment carries a
 *    client name and two sets of contact details; they are read here and go
 *    straight into the form. Only three strings describing a server are
 *    ever sent for interpretation.
 *
 * 3. **The AI is an enhancement, not a dependency.** A deterministic read
 *    runs first and handles most estates. The API is called only for what
 *    is left uncertain, and if it is unconfigured or fails, the import
 *    proceeds on the local reading with the gap shown.
 */
export function AssessmentImportPanel({ state, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [aiNote, setAiNote] = useState<string>();
  const [plan, setPlan] = useState<ImportPlan>();
  const [accepted, setAccepted] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    if (!plan) return [];
    const groups: Array<{ id: ImportGroup; changes: ImportPlan['changes'] }> = [];
    for (const change of plan.changes) {
      const existing = groups.find((g) => g.id === change.group);
      if (existing) existing.changes.push(change);
      else groups.push({ id: change.group, changes: [change] });
    }
    return groups;
  }, [plan]);

  function reset() {
    setPlan(undefined);
    setAccepted(new Set());
    setError(undefined);
    setAiNote(undefined);
  }

  async function analyse() {
    setBusy(true);
    reset();

    const parsed = parseAssessmentExport(raw);
    if (!parsed.ok) {
      setError(parsed.error);
      setBusy(false);
      return;
    }

    const strings = technicalStringsFor(parsed.export);

    // Belt and braces. The payload is built from three named technical
    // fields, so this should never fire — if it does, something upstream
    // changed and the request must not go out.
    if (containsPersonalData(strings)) {
      setError(
        'The technical fields appear to contain an email address. Nothing was sent — check the assessment.'
      );
      setBusy(false);
      return;
    }

    let interpretation: Interpretation = interpretLocally(strings);

    if (needsInterpretation(interpretation)) {
      try {
        const remote = await interpretTechnicalStrings(strings);
        interpretation = { ...remote, source: 'ai' };
        setAiNote(
          'Some fields were read by Claude because they could not be parsed directly. Check them below.'
        );
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 0;
        setAiNote(
          status === 503
            ? 'AI interpretation is not configured on this environment, so only what could be read directly has been filled in. Anything it could not work out is marked below.'
            : 'AI interpretation was unavailable, so only what could be read directly has been filled in. Anything it could not work out is marked below.'
        );
      }
    }

    const seed = buildSeed(parsed.export, interpretation);
    const next = planImport(state, seed);
    setPlan(next);
    setAccepted(allChangeIds(next));
    setBusy(false);

    if (next.changes.length === 0) {
      setError('The assessment matches this quote already — nothing to change.');
    }
  }

  function toggle(id: string) {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function apply() {
    if (!plan) return;
    onApply(plan, accepted);
    setOpen(false);
    setRaw('');
    reset();
  }

  if (!open) {
    return (
      <div className="panel import-collapsed">
        <div className="panel-head">
          <div>
            <h3 className="panel-title">Start from an assessment</h3>
            <p className="panel-note">
              Paste the JSON export from the SAP Pre-Sales Install Assessment to
              pre-fill the client, route and effort.
            </p>
          </div>
          <button type="button" className="btn-primary-ghost" onClick={() => setOpen(true)}>
            Import
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel import-panel">
      <div className="panel-head">
        <h3 className="panel-title">Import from assessment</h3>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setOpen(false);
            reset();
          }}
        >
          Close
        </button>
      </div>

      <div className="notice notice--info">
        The client name and contact details are read here and stay in this
        browser. Only the operating system, authentication and platform version
        strings are sent for interpretation — nothing that identifies the client
        or a person.
      </div>

      <textarea
        className="field-textarea import-textarea"
        rows={7}
        spellCheck={false}
        placeholder='Paste the assessment export here — it starts {"schemaVersion": 2, "tool": "sap-install-assessment", …'
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
      />

      <div className="import-actions">
        <button
          type="button"
          className="btn-primary-ghost"
          onClick={analyse}
          disabled={busy || raw.trim() === ''}
        >
          {busy ? 'Reading…' : 'Analyse'}
        </button>
        {raw.trim() !== '' && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setRaw('');
              reset();
            }}
          >
            Clear
          </button>
        )}
      </div>

      {error && <div className="notice notice--warn import-msg">{error}</div>}
      {aiNote && <div className="notice notice--data import-msg">{aiNote}</div>}

      {plan && plan.changes.length > 0 && (
        <>
          <div className="import-summary">
            {seedSummaryLines(plan.seed).map((line, i) => (
              <div key={i} className={i === 0 ? 'import-summary-head' : undefined}>
                {line}
              </div>
            ))}
          </div>

          {plan.notes.length > 0 && (
            <div className="import-notes">
              <div className="import-notes-title">Read this before applying</div>
              <ul>
                {plan.notes.map((note) => (
                  <li key={note.id} className={note.severity === 'warn' ? 'is-warn' : undefined}>
                    {note.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan.conflicts.length > 0 && (
            <div className="notice notice--warn import-msg">
              {plan.conflicts.length} change
              {plan.conflicts.length === 1 ? '' : 's'} would overwrite something
              already entered. Those rows are marked — untick anything you want
              to keep.
            </div>
          )}

          <div className="import-diff">
            {grouped.map((group) => (
              <div key={group.id}>
                <div className="import-group">{GROUP_LABELS[group.id]}</div>
                {group.changes.map((change) => {
                  const isConflict =
                    plan.conflicts.includes(change.id) ||
                    plan.conflicts.includes(
                      change.kind === 'hours' ? change.code : change.id
                    );
                  return (
                    <label
                      key={change.id}
                      className={`import-row ${isConflict ? 'is-conflict' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={accepted.has(change.id)}
                        onChange={() => toggle(change.id)}
                      />
                      <span className="import-label">{change.label}</span>
                      <span className="import-from">{change.from}</span>
                      <span className="import-arrow" aria-hidden="true">
                        →
                      </span>
                      <span className="import-to">{change.to}</span>
                      {change.note && <span className="import-note">{change.note}</span>}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>

          <p className="panel-note">{NEVER_SEEDED_NOTE}</p>

          <div className="import-actions">
            <button
              type="button"
              className="btn-primary-ghost"
              onClick={apply}
              disabled={accepted.size === 0}
            >
              Apply {accepted.size} of {plan.changes.length}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setAccepted(allChangeIds(plan))}>
              Select all
            </button>
            <button type="button" className="btn-ghost" onClick={() => setAccepted(new Set())}>
              Select none
            </button>
          </div>
        </>
      )}
    </div>
  );
}
