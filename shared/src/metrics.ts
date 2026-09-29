/**
 * Metrics, formulas and evidence rules.
 *
 * Two rules govern everything in this file:
 *   1. Every number shown to a learner links back to stored evidence (a transcript
 *      word, a timestamp range, or a quoted sentence).
 *   2. A metric whose source provider is missing is `null`, never a guess.
 */

export const METRIC_SOURCE = {
  wordTimestamps: 'word_timestamps',
  transcript: 'transcript',
  llmRubric: 'llm_rubric',
  pronunciationProvider: 'pronunciation_provider',
} as const;

export type MetricSource = (typeof METRIC_SOURCE)[keyof typeof METRIC_SOURCE];

export type MetricKey =
  | 'accuracy'
  | 'range'
  | 'fluency'
  | 'continuity'
  | 'composure'
  | 'words_per_minute'
  | 'speaking_time_ratio'
  | 'pause_count'
  | 'long_pause_count'
  | 'mean_response_delay_ms'
  | 'fillers_per_minute'
  | 'grammar'
  | 'vocabulary'
  | 'sentence_variety'
  | 'answer_quality'
  | 'pronunciation'
  | 'answer_score'
  | 'star_ratio'
  | 'delivery';

/** How long after finishing speaking we expect the AI voice to start. */
export const LATENCY_TARGETS_MS = {
  p50: 3000,
  p90: 6000,
  /** A pause longer than this counts as a "long pause". */
  longPauseMs: 1500,
  /** Silence after the learner stops that triggers end-of-turn detection. */
  endOfTurnHangoverMs: 1800,
  /** Confidence Mode waits longer before deciding the learner is done. */
  confidenceModeHangoverMs: 2500,
} as const;

/** Sessions needed before we show a trend instead of a single-session number. */
export const MIN_SESSIONS_FOR_TREND = 3;

/** Turns shorter than this are treated as noise rather than an answer. */
export const MIN_MEANINGFUL_TURN_WORDS = 3;

/** Below this transcription confidence a word is excluded from judging. */
export const LOW_CONFIDENCE_WORD_THRESHOLD = 0.55;

export interface EvidencePointer {
  kind: 'transcript_span' | 'word_timing' | 'quoted_sentence' | 'answer';
  /** Monotonic id of the stored session turn this evidence belongs to. */
  turnId: string;
  /** Human readable pointer used in the UI, e.g. "2.4s - 3.1s". */
  label: string;
}

export interface MetricDefinition {
  key: MetricKey;
  /** Plain-language name for the report. Never "F1 score", never jargon. */
  label: string;
  source: MetricSource;
  /** True when the metric cannot be produced without the named capability. */
  requires?: { wordTimestamps?: boolean; pronunciationProvider?: boolean };
  /** Shown instead of a number when the source is unavailable. */
  unavailableLabel: string;
  /** Whether a trend line is allowed yet. */
  minSessionsForTrend: number;
}

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    key: 'accuracy',
    label: 'Getting your meaning across',
    source: METRIC_SOURCE.transcript,
    unavailableLabel: 'Not available',
    minSessionsForTrend: MIN_SESSIONS_FOR_TREND,
  },
  {
    key: 'range',
    label: 'How much English you can use',
    source: METRIC_SOURCE.transcript,
    unavailableLabel: 'Not available',
    minSessionsForTrend: MIN_SESSIONS_FOR_TREND,
  },
  {
    key: 'fluency',
    label: 'Flow',
    source: METRIC_SOURCE.wordTimestamps,
    requires: { wordTimestamps: true },
    unavailableLabel: 'Captions were used, so flow was not measured',
    minSessionsForTrend: MIN_SESSIONS_FOR_TREND,
  },
  {
    key: 'continuity',
    label: 'Keeping the conversation going',
    source: METRIC_SOURCE.wordTimestamps,
    requires: { wordTimestamps: true },
    unavailableLabel: 'Captions were used, so continuity was not measured',
    minSessionsForTrend: MIN_SESSIONS_FOR_TREND,
  },
  {
    key: 'composure',
    label: 'Steadiness under normal pressure',
    source: METRIC_SOURCE.wordTimestamps,
    requires: { wordTimestamps: true },
    unavailableLabel: 'Captions were used, so steadiness was not measured',
    minSessionsForTrend: MIN_SESSIONS_FOR_TREND,
  },
  {
    key: 'words_per_minute',
    label: 'Speaking speed',
    source: METRIC_SOURCE.wordTimestamps,
    requires: { wordTimestamps: true },
    unavailableLabel: 'Captions were used, so speed was not measured',
    minSessionsForTrend: MIN_SESSIONS_FOR_TREND,
  },
  {
    key: 'fillers_per_minute',
    label: 'Filler words',
    source: METRIC_SOURCE.transcript,
    unavailableLabel: 'Not available',
    minSessionsForTrend: MIN_SESSIONS_FOR_TREND,
  },
  {
    key: 'pronunciation',
    label: 'Pronunciation',
    source: METRIC_SOURCE.pronunciationProvider,
    requires: { pronunciationProvider: true },
    unavailableLabel: 'Not assessed',
    minSessionsForTrend: MIN_SESSIONS_FOR_TREND,
  },
];

/**
 * SCI — Speaking Confidence Indicator, version 1.0.0.
 *
 * Name and wording are deliberate: this describes observable speaking behaviour,
 * not the learner's confidence, mood or ability. We never infer psychological
 * state from speech.
 */
export const SCI_FORMULA = {
  id: 'SCI-v1.0.0' as const,
  scale: { min: 0, max: 100 },
  components: {
    accuracy: 0.25,
    range: 0.15,
    fluency: 0.2,
    continuity: 0.2,
    composure: 0.2,
  },
  /**
   * When a component is unavailable (for example no word timestamps) the weight
   * is dropped and the total is renormalised over the components we do have, so
   * a missing capability lowers confidence in the number, never the learner's
   * result. The UI states which components were included.
   */
  renormaliseWhenMissing: true,
  minSessionsBeforeDisplay: 1,
} as const;

/**
 * IRS — Interview Readiness, version 1.0.0.
 *
 * A transparent weighted view of past answers. It is a preparation aid, never a
 * prediction of hiring outcomes.
 */
export const IRS_FORMULA = {
  id: 'IRS-v1.0.0' as const,
  scale: { min: 0, max: 100 },
  components: {
    answer_score: 0.5,
    star_ratio: 0.3,
    delivery: 0.2,
  },
  minScoredAnswers: 5,
  minSessionsBeforeDisplay: 1,
  disclaimer:
    'This reflects the answers you have practised here. It is not a prediction of any interview result.',
} as const;

/**
 * Candidate filler words. The extractor model must confirm each one against the
 * transcript and return the exact text it found; nothing is counted from this list
 * alone.
 */
export const CANDIDATE_FILLER_WORDS = [
  'um',
  'uh',
  'er',
  'erm',
  'ah',
  'hmm',
  'like',
  'so',
  'basically',
  'actually',
  'literally',
] as const;

/** Accuracy/spelling variant matching: "dont" -> "don't", "im" -> "I'm". */
export const CONTRACTIONS: ReadonlyArray<[RegExp, string]> = [
  [/\b(dont)\b/gi, "don't"],
  [/\b(doesnt)\b/gi, "doesn't"],
  [/\b(didnt)\b/gi, "didn't"],
  [/\b(isnt)\b/gi, "isn't"],
  [/\b(arent)\b/gi, "aren't"],
  [/\b(wasnt)\b/gi, "wasn't"],
  [/\b(werent)\b/gi, "weren't"],
  [/\b(cant)\b/gi, "can't"],
  [/\b(wont)\b/gi, "won't"],
  [/\b(im)\b/gi, "I'm"],
  [/\b(ive)\b/gi, "I've"],
  [/\b(id)\b/gi, "I'd"],
  [/\b(ill)\b/gi, "I'll"],
  [/\b(youre)\b/gi, "you're"],
  [/\b(youve)\b/gi, "you've"],
  [/\b(theyre)\b/gi, "they're"],
  [/\b(its)\b/gi, "it's"],
];
