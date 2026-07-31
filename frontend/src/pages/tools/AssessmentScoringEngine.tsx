import { useMemo, useState } from 'react';

import { TopBar } from '../../components/TopBar';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { resolvePath } from '../../config/navigation';
import { APP_VERSION } from '../../config/app';
import {
  EXAMPLE_INPUT,
  OVERALL_BANDS,
  QUESTIONS,
  SCURVE,
  SECTIONS,
  type SectionId
} from '../../config/assessmentModel';
import {
  assessConfidence,
  getOverallBand,
  getSCurveStage,
  getSectionBand,
  parseEmail,
  processScoring,
  severityColour,
  type InfluencerDetail,
  type QuestionResult,
  type ScoringResult,
  type ToolPenalty
} from '../../lib/scoring/assessmentScoring';
import { GaugeRing } from './GaugeRing';
import { SCurveChart } from './SCurveChart';
import '../../styles/tool.css';
import './AssessmentScoringEngine.css';

type Tab = 'process' | 'methodology';

const SECTION_COLOUR: Record<SectionId, string> = {
  dfg: 'var(--sec-dfg)',
  ids: 'var(--sec-ids)',
  air: 'var(--sec-air)',
  va: 'var(--sec-va)'
};

/**
 * Analytics & AI Assessment — Scoring Engine.
 *
 * Paste a client's questionnaire response, get template-ready scores.
 *
 * Runs entirely in the browser. The pasted text contains a named person,
 * their employer and their email address; keeping the work client-side
 * means that personal data never reaches a server or a log. Do not add
 * an API call here without a deliberate decision about the personal data
 * involved.
 */
export function AssessmentScoringEngine() {
  const [tab, setTab] = useState<Tab>('process');
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);

  const trail = resolvePath(['data-ai'])?.trail ?? [];

  const analysis = useMemo(() => {
    if (!submitted?.trim()) return null;
    const parsed = parseEmail(submitted);
    const results = processScoring(parsed);
    return { parsed, results, confidence: assessConfidence(results) };
  }, [submitted]);

  return (
    <>
      <TopBar links={[{ label: 'Data & AI', to: '/area/data-ai' }, { label: 'All areas', to: '/' }]} />

      <main className="page">
        <Breadcrumbs trail={trail} tail="Assessment Scoring Engine" />

        <section className="tool-header reveal reveal-1">
          <div>
            <div className="eyebrow">Assessments</div>
            <h1 className="display">
              Assessment <em>Scoring Engine</em>
            </h1>
            <p className="lede">
              Paste a completed Analytics &amp; AI maturity response to produce
              section scores, an overall band and an S-curve position ready for
              the assessment output document.
            </p>
          </div>
          <div className="tool-header-meta">
            <div><strong>{QUESTIONS.length}</strong> questions</div>
            <div><strong>{SECTIONS.length}</strong> sections</div>
            <div><strong>{APP_VERSION}</strong></div>
          </div>
        </section>

        <div className="tool-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'process'}
            className={`tool-tab ${tab === 'process' ? 'is-active' : ''}`}
            onClick={() => setTab('process')}
          >
            Process response
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'methodology'}
            className={`tool-tab ${tab === 'methodology' ? 'is-active' : ''}`}
            onClick={() => setTab('methodology')}
          >
            Methodology reference
          </button>
        </div>

        {tab === 'process' ? (
          <>
            <div className="notice notice--info">
              <strong>Stays on this device.</strong> Scoring runs entirely in
              your browser — the response you paste is never uploaded, stored or
              logged. Closing the tab discards it.
            </div>

            <div className="input-head">
              <h2>Paste client response</h2>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setInput(EXAMPLE_INPUT)}
              >
                Load example
              </button>
            </div>

            <textarea
              className="response-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste the email response text here — one “Question: Answer” per line…"
              aria-label="Client assessment response"
              spellCheck={false}
            />

            <div className="input-actions">
              <button
                type="button"
                className="btn"
                disabled={!input.trim()}
                onClick={() => setSubmitted(input)}
              >
                Process &amp; score →
              </button>
              {submitted && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setInput('');
                    setSubmitted(null);
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            {analysis && (
              <Results
                meta={analysis.parsed.meta}
                results={analysis.results}
                confidence={analysis.confidence}
              />
            )}
          </>
        ) : (
          <Methodology />
        )}
      </main>

      <footer className="page-footer">
        SMB Pre-Sales Portal · {APP_VERSION} · Codestone internal use only
      </footer>
    </>
  );
}

// ─── Results ─────────────────────────────────────────────────────────

function Results({
  meta,
  results,
  confidence
}: {
  meta: { name?: string; company?: string; jobFunction?: string; email?: string };
  results: ScoringResult;
  confidence: ReturnType<typeof assessConfidence>;
}) {
  if (confidence.level === 'unusable') {
    return (
      <div className="verdict-block verdict-block--error" role="alert">
        <h3>This response can&rsquo;t be scored</h3>
        <p>{confidence.message}</p>
        <p className="verdict-block-detail">
          No score is shown deliberately. A partial parse can still produce a
          plausible-looking number, and a wrong figure in an assessment document
          is worse than no figure.
        </p>
      </div>
    );
  }

  const overall = results.overallScore;
  const band = getOverallBand(overall);
  const stage = getSCurveStage(overall);

  return (
    <div className="results">
      <div className="client-card">
        <div className="client-avatar">{(meta.name ?? '?').charAt(0).toUpperCase()}</div>
        <div>
          <div className="client-name">{meta.name || 'Unknown respondent'}</div>
          <div className="client-meta">
            {meta.company}
            {meta.jobFunction ? ` · ${meta.jobFunction}` : ''}
          </div>
          {meta.email && <div className="client-email">{meta.email}</div>}
        </div>
      </div>

      {confidence.level === 'partial' && (
        <div className="verdict-block verdict-block--warn" role="alert">
          <h3>
            {confidence.totalCount - confidence.scoredCount} of{' '}
            {confidence.totalCount} questions could not be scored
          </h3>
          <p>{confidence.message}</p>
          <ul className="unmatched-list">
            {results.unmatched.map((u) => (
              <li key={u.key}>
                <span className="unmatched-section">
                  {SECTIONS.find((s) => s.id === u.section)?.title}
                </span>{' '}
                {u.question}…{' '}
                <em>
                  {u.unmatchedReason === 'missing'
                    ? '(no answer in response)'
                    : '(answer present but no keyword match)'}
                </em>
                {u.rawAnswer && <div className="unmatched-raw">“{u.rawAnswer}”</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="panel overall-panel">
        <div className="overall-gauge">
          <GaugeRing score={overall} size={132} stroke={11} colour={band.color} />
          <div className="overall-band" style={{ color: band.color }}>
            {band.label}
          </div>
          <div className="overall-caption">Overall maturity</div>
        </div>

        <div className="section-bars">
          {SECTIONS.map((section) => {
            const score = results.sectionScores[section.id] ?? 0;
            const sectionBand = getSectionBand(section.id, score);
            return (
              <div className="section-bar" key={section.id}>
                <div className="section-bar-label">
                  {section.title}
                  <span className="section-bar-weight">
                    {Math.round(section.weight * 100)}%
                  </span>
                </div>
                <div className="section-bar-track">
                  <div
                    className="section-bar-fill"
                    style={{
                      width: `${score}%`,
                      background: SECTION_COLOUR[section.id]
                    }}
                  />
                  <span className="section-bar-value">{Math.round(score)}%</span>
                </div>
                <div
                  className="section-bar-band"
                  style={{ color: SECTION_COLOUR[section.id] }}
                >
                  {sectionBand.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Maturity journey position</h3>
        <SCurveChart score={overall} stages={SCURVE} />
        <div className="scurve-caption">
          <strong>{stage.label}</strong>
          <span>{stage.sub}</span>
        </div>
      </div>

      <TemplateValues results={results} />

      <h3 className="breakdown-title">Question-level breakdown</h3>
      {SECTIONS.map((section) => (
        <div className="panel qsection" key={section.id}>
          <header
            className="qsection-head"
            style={{ borderLeftColor: SECTION_COLOUR[section.id] }}
          >
            <span>{section.title}</span>
            <strong style={{ color: SECTION_COLOUR[section.id] }}>
              {Math.round(results.sectionScores[section.id] ?? 0)}%
            </strong>
          </header>
          <div className="qsection-body">
            {results.questionResults
              .filter((q) => q.section === section.id)
              .map((q) => (
                <QuestionRow key={q.key} result={q} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function scoreClass(score: number | null): string {
  if (score === null) return 'q-score q-score--none';
  if (score >= 50) return 'q-score q-score--good';
  if (score >= 25) return 'q-score q-score--mid';
  return 'q-score q-score--low';
}

function QuestionRow({ result }: { result: QuestionResult }) {
  return (
    <div className="q-item">
      <div className="q-item-head">
        <div className="q-item-question">
          {result.question}…
          <span className="q-item-weight">wt {Math.round(result.weight * 100)}%</span>
        </div>
        <div className={scoreClass(result.score)}>
          {result.score !== null ? `${Math.round(result.score)}%` : '—'}
        </div>
      </div>

      {result.rawAnswer && <div className="q-item-answer">“{result.rawAnswer}”</div>}

      {result.type === 'influencer' && isInfluencer(result.details) && (
        <div className="influencer">
          <div>
            <span className="influencer-head influencer-head--pos">
              Positives +{result.details.posTotal}
            </span>
            {result.details.posMatched.length ? (
              result.details.posMatched.map((p) => <div key={p.match[0]}>• {p.match[0]}</div>)
            ) : (
              <div className="influencer-none">None selected</div>
            )}
          </div>
          <div>
            <span className="influencer-head influencer-head--neg">
              Negatives {result.details.negTotal}
            </span>
            {result.details.negMatched.length ? (
              result.details.negMatched.map((n) => (
                <div key={n.match[0]}>
                  <span
                    className="severity-dot"
                    style={{ background: severityColour(n.severity) }}
                  />
                  {n.match[0]}{' '}
                  <span style={{ color: severityColour(n.severity) }}>({n.points}pt)</span>
                </div>
              ))
            ) : (
              <div className="influencer-none">None selected</div>
            )}
          </div>
          <div className="influencer-net">
            Net {result.details.net} (range {result.details.maxNeg} to +
            {result.details.maxPos}) → {Math.round(result.score ?? 0)}%
          </div>
        </div>
      )}

      {result.type === 'tool_penalty' && isToolPenalty(result.details) && (
        <div className="penalty">
          <span className={`penalty-chip penalty-chip--${result.details.tier.toLowerCase()}`}>
            {result.details.tier} penalty · {result.details.penalty}pt
          </span>
          <span className="penalty-label">{result.details.label}</span>
        </div>
      )}
    </div>
  );
}

function isInfluencer(d: QuestionResult['details']): d is InfluencerDetail {
  return typeof d === 'object' && d !== null && 'posMatched' in d;
}

function isToolPenalty(d: QuestionResult['details']): d is ToolPenalty {
  return typeof d === 'object' && d !== null && 'tier' in d;
}

// ─── Template-ready values ───────────────────────────────────────────

function TemplateValues({ results }: { results: ScoringResult }) {
  const [copied, setCopied] = useState(false);
  const overall = results.overallScore;
  const band = getOverallBand(overall);
  const stage = getSCurveStage(overall);

  const lines = useMemo(() => {
    const rows = [
      `Overall Score: ${Math.round(overall)}% → ${band.label}`,
      ...SECTIONS.map((s) => {
        const v = results.sectionScores[s.id] ?? 0;
        return `${s.title}: ${Math.round(v)}% → ${getSectionBand(s.id, v).label}`;
      }),
      `S-Curve Position: ${stage.label} (${stage.sub})`
    ];
    return rows;
  }, [results, overall, band.label, stage.label, stage.sub]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="panel output-panel">
      <div className="panel-head">
        <h3 className="panel-title">Template-ready values</h3>
        <button type="button" className="btn-ghost" onClick={copy}>
          {copied ? 'Copied' : 'Copy all'}
        </button>
      </div>
      <p className="panel-note">Paste directly into the assessment output document.</p>
      <pre className="output-block">{lines.join('\n')}</pre>
    </div>
  );
}

// ─── Methodology ─────────────────────────────────────────────────────

const LAYERS = [
  {
    n: '1',
    title: 'Question scores',
    body: 'Band questions take the midpoint of the matched range. Influencer questions net positives against weighted negatives. The tool question applies a graduated penalty.'
  },
  {
    n: '2',
    title: 'Section scores',
    body: 'Weighted average of the questions within each section. Higher-weight questions are more diagnostic of real capability.'
  },
  {
    n: '3',
    title: 'Overall score',
    body: 'Data Foundations 30% · Insight & Decision 25% · AI Readiness 20% · Value & Agility 25%.'
  },
  {
    n: '4',
    title: 'S-curve mapping',
    body: 'The overall percentage maps to a maturity stage, from Reactive & Ad Hoc through to Strategic Insight.'
  }
];

const PENALTY_TIERS = [
  { tier: 'Heavy · −20pt', desc: 'Excel, Crystal or SSRS as the primary analytics platform, no modern BI' },
  { tier: 'Moderate · −10pt', desc: 'Legacy tools alongside a modern platform' },
  { tier: 'Moderate · −8pt', desc: 'Supplementary legacy tools (e.g. Access) only' },
  { tier: 'Light · −4pt', desc: 'Minor legacy presence with modern tools' },
  { tier: 'None · 0pt', desc: 'No legacy tool dependency' }
];

function Methodology() {
  return (
    <div className="methodology">
      <div className="panel">
        <h3 className="panel-title">Scoring architecture</h3>
        <p className="panel-note">
          Four layers: question → section → overall → S-curve position.
        </p>
        <div className="layer-grid">
          {LAYERS.map((l) => (
            <div className="layer" key={l.n}>
              <div className="layer-num">{l.n}</div>
              <div>
                <div className="layer-title">{l.title}</div>
                <p>{l.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Influencer formula</h3>
        <pre className="formula">score % = ((net − min) / (max − min)) × 100</pre>
        <p className="panel-note">
          Each positive is +1. Negatives are weighted by severity: Basic −1,
          Intermediate −2, High −3. Max is the sum of all positives; min is the
          sum of all negative weights.
        </p>
      </div>

      <div className="panel">
        <h3 className="panel-title">Section and question weights</h3>
        {SECTIONS.map((section) => (
          <div className="weight-group" key={section.id}>
            <div className="weight-group-head">
              <span
                className="weight-dot"
                style={{ background: SECTION_COLOUR[section.id] }}
              />
              <strong>{section.title}</strong>
              <span className="weight-overall">
                {Math.round(section.weight * 100)}% of overall
              </span>
            </div>
            {QUESTIONS.filter((q) => q.section === section.id).map((q) => (
              <div className="weight-row" key={q.key}>
                <span className="weight-pct" style={{ color: SECTION_COLOUR[section.id] }}>
                  {Math.round(q.weight * 100)}%
                </span>
                <span className="weight-question">
                  {q.question}…
                  <span className={`type-chip type-chip--${q.type}`}>
                    {q.type === 'tool_penalty' ? 'tool penalty' : q.type}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="panel">
        <h3 className="panel-title">Overall score bands</h3>
        <div className="band-strip">
          {OVERALL_BANDS.map((b) => (
            <div
              className="band-chip"
              key={b.label}
              style={{ flex: b.max - b.min, background: b.color }}
            >
              <span>{b.label}</span>
              <em>
                {b.min}–{b.max}%
              </em>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">S-curve stages</h3>
        <div className="band-strip">
          {SCURVE.map((s) => (
            <div
              className="band-chip"
              key={s.label}
              style={{ flex: s.max - s.min, background: s.color }}
            >
              <span>{s.label}</span>
              <em>
                {s.min}–{s.max}%
              </em>
              <em className="band-chip-sub">{s.sub}</em>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Tool penalty tiers</h3>
        {PENALTY_TIERS.map((p) => (
          <div className="penalty-row" key={p.tier}>
            <span className="penalty-tier">{p.tier}</span>
            <span>{p.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
