/**
 * Analytics & AI Assessment — scoring engine.
 *
 * Pure functions, no DOM, no network. Ported from the standalone HTML
 * prototype with the arithmetic preserved exactly — see
 * `__fixtures__/kermit.json` for the pinned reference output.
 *
 * ## Why this runs entirely in the browser
 *
 * The pasted response contains a named individual, their employer, job
 * title and email address. Scoring client-side means that personal data
 * never reaches a Codestone server, never enters an application log, and
 * never needs a retention policy. There is no API call in this feature
 * and one should not be added without a deliberate decision about the
 * personal data involved.
 */

import {
  LEGACY_PRIMARY,
  LEGACY_SUPP,
  MODERN,
  OVERALL_BANDS,
  QUESTIONS,
  SCURVE,
  SECTIONS,
  SECTION_BANDS,
  type Band,
  type NegativeInfluencer,
  type OverallBand,
  type PositiveInfluencer,
  type Question,
  type SCurveStage,
  type SectionId,
  type Severity
} from '../../config/assessmentModel';

// ─── Types ───────────────────────────────────────────────────────────

export interface ParsedMeta {
  name?: string;
  company?: string;
  jobFunction?: string;
  email?: string;
}

export interface ParsedResponse {
  meta: ParsedMeta;
  answers: Record<string, string>;
}

export type PenaltyTier = 'Heavy' | 'Moderate' | 'Light' | 'None';

export interface ToolPenalty {
  penalty: number;
  label: string;
  tier: PenaltyTier;
}

export interface BandDetail {
  score: number | null;
  bandIndex: number;
  matched: string | null;
}

export interface InfluencerDetail {
  score: number;
  posTotal: number;
  negTotal: number;
  net: number;
  posMatched: PositiveInfluencer[];
  negMatched: NegativeInfluencer[];
  maxPos: number;
  maxNeg: number;
}

export type UnmatchedReason = 'missing' | 'no_keyword_match';

export interface QuestionResult {
  key: string;
  section: SectionId;
  weight: number;
  question: string;
  type: Question['type'];
  rawAnswer: string | null;
  score: number | null;
  details: ToolPenalty | BandDetail | InfluencerDetail | string | null;
  unmatched?: boolean;
  unmatchedReason?: UnmatchedReason | null;
}

export interface ScoringResult {
  questionResults: QuestionResult[];
  sectionScores: Record<SectionId, number | null>;
  overallScore: number;
  unmatched: QuestionResult[];
}

// ─── Tool penalty ────────────────────────────────────────────────────

/**
 * Graduated drag applied when legacy reporting tools are the primary
 * analytics platform. Excel or Crystal as the only tooling is a stronger
 * signal of low maturity than any single questionnaire answer, so it is
 * scored separately rather than folded into a band.
 */
export function detectToolPenalty(answer: string): ToolPenalty {
  const lower = answer.toLowerCase();
  const tools = lower.split(',').map((t) => t.trim());
  const hasModern = tools.some((t) => MODERN.some((m) => t.includes(m)));
  const hasPrimary = tools.some((t) => LEGACY_PRIMARY.some((m) => t.includes(m)));
  const hasSupp = tools.some((t) => LEGACY_SUPP.some((m) => t.includes(m)));

  if (hasPrimary && !hasModern)
    return { penalty: -20, label: 'Primary legacy tools, no modern platform', tier: 'Heavy' };
  if (hasPrimary && hasModern)
    return { penalty: -10, label: 'Legacy tools alongside modern platform', tier: 'Moderate' };
  if (hasSupp && !hasModern)
    return { penalty: -8, label: 'Supplementary legacy tools only', tier: 'Moderate' };
  if (hasSupp && hasModern)
    return { penalty: -4, label: 'Minor legacy presence with modern tools', tier: 'Light' };
  return { penalty: 0, label: 'No legacy tool dependency', tier: 'None' };
}

// ─── Parsing ─────────────────────────────────────────────────────────

/**
 * Parse a pasted email response into metadata and per-question answers.
 *
 * Questions are matched on the first 40 characters of their configured
 * text, which tolerates the trailing guidance wording that varies between
 * form versions. An unrecognised line is skipped rather than guessed at —
 * a wrong match would silently score the wrong question.
 */
export function parseEmail(text: string): ParsedResponse {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const result: ParsedResponse = { meta: {}, answers: {} };

  for (const line of lines) {
    const lower = line.toLowerCase();
    const after = () => line.split(':').slice(1).join(':').trim();

    if (lower.startsWith('name:')) result.meta.name = after();
    else if (lower.startsWith('company:')) result.meta.company = after();
    else if (lower.startsWith('job function:')) result.meta.jobFunction = after();
    else if (lower.startsWith('email:')) result.meta.email = after();
    else {
      const ci = line.indexOf(':');
      if (ci === -1) continue;
      const qPart = line.substring(0, ci).toLowerCase();
      const aPart = line.substring(ci + 1).trim();
      for (const q of QUESTIONS) {
        const qk = q.question.toLowerCase();
        if (qPart.includes(qk.substring(0, Math.min(40, qk.length)))) {
          result.answers[q.key] = aPart;
          break;
        }
      }
    }
  }

  return result;
}

// ─── Question scoring ────────────────────────────────────────────────

/**
 * Bands are checked **last to first** so that when an answer contains
 * phrases from more than one band, the most mature match wins.
 */
export function scoreBand(answer: string, mappings: { match: string[]; score: number }[]): BandDetail {
  const lower = answer.toLowerCase();
  for (let i = mappings.length - 1; i >= 0; i--) {
    const hit = mappings[i].match.find((f) => lower.includes(f.toLowerCase()));
    if (hit) return { score: mappings[i].score, bandIndex: i, matched: hit };
  }
  return { score: null, bandIndex: -1, matched: null };
}

/**
 * Multi-select questions: sum the selected positives and negatives, then
 * map the net onto 0–100 across the theoretical range.
 *
 *   score % = ((net − min) / (max − min)) × 100
 */
export function scoreInfluencer(
  answer: string,
  positives: PositiveInfluencer[],
  negatives: NegativeInfluencer[]
): InfluencerDetail {
  const lower = answer.toLowerCase();
  const maxPos = positives.reduce((s, p) => s + p.points, 0);
  const maxNeg = negatives.reduce((s, n) => s + n.points, 0);

  const posMatched = positives.filter((p) => p.match.some((f) => lower.includes(f.toLowerCase())));
  const negMatched = negatives.filter((n) => n.match.some((f) => lower.includes(f.toLowerCase())));

  const posTotal = posMatched.reduce((s, p) => s + p.points, 0);
  const negTotal = negMatched.reduce((s, n) => s + n.points, 0);
  const net = posTotal + negTotal;
  const pct = ((net - maxNeg) / (maxPos - maxNeg)) * 100;

  return {
    score: Math.max(0, Math.min(100, pct)),
    posTotal,
    negTotal,
    net,
    posMatched,
    negMatched,
    maxPos,
    maxNeg
  };
}

// ─── Aggregation ─────────────────────────────────────────────────────

export function processScoring(parsed: ParsedResponse): ScoringResult {
  const questionResults: QuestionResult[] = [];

  for (const q of QUESTIONS) {
    const answer = parsed.answers[q.key];
    const base = {
      key: q.key,
      section: q.section,
      weight: q.weight,
      question: q.question,
      type: q.type
    };

    if (!answer && q.type !== 'tool_penalty') {
      questionResults.push({
        ...base,
        rawAnswer: null,
        score: null,
        details: 'No answer found',
        unmatched: true,
        unmatchedReason: 'missing'
      });
      continue;
    }

    if (q.type === 'tool_penalty') {
      const raw = parsed.answers['tool_penalty'] ?? '';
      const penalty = detectToolPenalty(raw);
      questionResults.push({
        ...base,
        rawAnswer: raw,
        // A −20 penalty floors this question at 0; a clean estate sits at 50.
        score: Math.max(0, 50 + penalty.penalty * 2.5),
        details: penalty
      });
    } else if (q.type === 'band') {
      const detail = scoreBand(answer, q.mappings);
      questionResults.push({
        ...base,
        rawAnswer: answer,
        score: detail.score,
        details: detail,
        unmatched: detail.score === null,
        unmatchedReason: detail.score === null ? 'no_keyword_match' : null
      });
    } else {
      const detail = scoreInfluencer(answer, q.positives, q.negatives);
      questionResults.push({ ...base, rawAnswer: answer, score: detail.score, details: detail });
    }
  }

  // Section score = weighted average over the questions that actually
  // scored. Unscored questions are excluded rather than treated as zero —
  // a parsing gap must not read as a capability gap. The UI warns when
  // this happens, because the average is then over partial data.
  const sectionScores = {} as Record<SectionId, number | null>;
  for (const section of SECTIONS) {
    const scored = questionResults.filter((r) => r.section === section.id && r.score !== null);
    if (!scored.length) {
      sectionScores[section.id] = null;
      continue;
    }
    const weightSum = scored.reduce((s, r) => s + r.weight, 0);
    sectionScores[section.id] =
      scored.reduce((s, r) => s + (r.score as number) * r.weight, 0) / weightSum;
  }

  let weighted = 0;
  let weightTotal = 0;
  for (const section of SECTIONS) {
    const score = sectionScores[section.id];
    if (score !== null) {
      weighted += score * section.weight;
      weightTotal += section.weight;
    }
  }

  return {
    questionResults,
    sectionScores,
    overallScore: weightTotal > 0 ? weighted / weightTotal : 0,
    unmatched: questionResults.filter((r) => r.unmatched)
  };
}

// ─── Result confidence ───────────────────────────────────────────────

export type Confidence = 'ok' | 'partial' | 'unusable';

export interface ConfidenceVerdict {
  level: Confidence;
  scoredCount: number;
  totalCount: number;
  message: string;
}

/**
 * How much of the response actually scored — and whether the result is
 * safe to put in front of a client.
 *
 * **This guards a real failure mode inherited from the prototype.** The
 * tool-penalty question scores even when nothing is pasted: an empty
 * estate reads as "no legacy dependency" and lands at 50. With every
 * other question unmatched, Data Foundations then averages to 50 and the
 * overall score comes out at **50% — "Proactive Performer"** — from an
 * empty box.
 *
 * A flattering, plausible-looking number produced from no data is far
 * more dangerous than a visible error, because nothing about it invites
 * a second look before it reaches an assessment document.
 *
 * The arithmetic is deliberately left alone so scores stay reproducible
 * against the prototype; this is a presentation gate on top of it.
 */
export function assessConfidence(result: ScoringResult): ConfidenceVerdict {
  const substantive = result.questionResults.filter((r) => r.type !== 'tool_penalty');
  const scored = substantive.filter((r) => r.score !== null);
  const total = substantive.length;

  if (scored.length === 0) {
    return {
      level: 'unusable',
      scoredCount: 0,
      totalCount: total,
      message:
        'No questions could be scored. Check the pasted text is a complete assessment response — the expected format is one "Question: Answer" per line.'
    };
  }

  if (scored.length < total / 2) {
    return {
      level: 'unusable',
      scoredCount: scored.length,
      totalCount: total,
      message: `Only ${scored.length} of ${total} questions could be scored. That is too little to produce a meaningful result — check the response is complete and correctly formatted.`
    };
  }

  if (scored.length < total) {
    return {
      level: 'partial',
      scoredCount: scored.length,
      totalCount: total,
      message: `${total - scored.length} of ${total} questions could not be scored. Section averages are computed over the questions that did score, so affected sections rest on partial data.`
    };
  }

  return {
    level: 'ok',
    scoredCount: scored.length,
    totalCount: total,
    message: `All ${total} questions scored.`
  };
}

// ─── Band lookups ────────────────────────────────────────────────────

export function getSectionBand(sectionId: SectionId, score: number): Band {
  const bands = SECTION_BANDS[sectionId] ?? [];
  return bands.find((b) => score >= b.min && score < b.max) ?? bands[bands.length - 1];
}

export function getOverallBand(score: number): OverallBand {
  return (
    OVERALL_BANDS.find((b) => score >= b.min && score < b.max) ??
    OVERALL_BANDS[OVERALL_BANDS.length - 1]
  );
}

export function getSCurveStage(score: number): SCurveStage {
  return SCURVE.find((s) => score >= s.min && score < s.max) ?? SCURVE[SCURVE.length - 1];
}

/** Maps a negative influencer's severity to a palette token. */
export function severityColour(severity: Severity): string {
  return severity === 'High'
    ? 'var(--red)'
    : severity === 'Intermediate'
      ? 'var(--amber)'
      : 'var(--amber-light)';
}
