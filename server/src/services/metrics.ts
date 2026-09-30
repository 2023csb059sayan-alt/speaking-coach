import type { WordTiming, SegmentTiming } from '../models/PracticeSession';

/**
 * Speaking Confidence Indicators (SCI) — version SCI-v1.0.0
 *
 * Formula: 0.25 * accuracy + 0.15 * range + 0.20 * fluency + 0.20 * continuity + 0.20 * composure
 * Renormalised over available components (missing components are redistributed).
 *
 * Each component is 0–100. Missing components (e.g., no word timestamps for range)
 * cause the weight to be redistributed proportionally among available components.
 *
 * This is a SPEAKING CONFIDENCE INDICATOR, not psychological confidence.
 * It measures observable speech behaviours only.
 */

export const SCI_FORMULA_VERSION = 'SCI-v1.0.0';

export interface SciComponents {
  accuracy: number | null;       // vocabulary/grammar coverage
  range: number | null;          // vocabulary diversity (requires word timestamps)
  fluency: number | null;        // speech vs silence ratio
  continuity: number | null;     // pace consistency
  composure: number | null;      // hesitations, fillers, restarts
}

export interface SciResult {
  sci: number;
  components: SciComponents;
  formulaVersion: string;
  computedAt: Date;
  /** Which components were available for calculation */
  availableComponents: (keyof SciComponents)[];
  /** Evidence references for each component */
  evidence: {
    accuracy?: string;
    range?: string;
    fluency?: string;
    continuity?: string;
    composure?: string;
  };
}

/**
 * Compute fluency: ratio of speech time to total turn time.
 * Speech time = sum of (endMs - startMs) for all words with confidence > 0.5
 * Total time = last word endMs - first word startMs
 */
export function computeFluency(words: WordTiming[], totalTurnMs: number): number | null {
  if (!words.length || totalTurnMs <= 0) return null;

  const speechMs = words
    .filter((w) => (w.confidence ?? 1) > 0.5)
    .reduce((sum, w) => sum + Math.max(0, w.endMs - w.startMs), 0);

  const ratio = speechMs / totalTurnMs;
  // Map to 0-100 with a curve: 50% speech = ~70 fluency, 80% = ~90
  return Math.round(Math.min(100, ratio * 120));
}

/**
 * Compute vocabulary range: type-token ratio (unique words / total words)
 * Only works when word timestamps are available.
 */
export function computeRange(words: WordTiming[]): number | null {
  if (!words.length) return null;

  const tokens = words
    .filter((w) => (w.confidence ?? 1) > 0.5)
    .map((w) => w.word.toLowerCase().replace(/[^\w']/g, ''))
    .filter((w) => w.length > 0);

  if (!tokens.length) return null;

  const unique = new Set(tokens).size;
  const ttr = unique / tokens.length;

  // TTR of 0.4 = ~60, 0.6 = ~85, 0.8 = ~100
  return Math.round(Math.min(100, ttr * 125));
}

/**
 * Compute continuity: pace consistency (inverse of WPM variance)
 * WPM per segment = (word count / segment duration) * 60000
 */
export function computeContinuity(segments: SegmentTiming[], words: WordTiming[]): number | null {
  if (segments.length < 2 || words.length < 5) return null;

  const segmentWpms: number[] = [];

  for (const seg of segments) {
    const segWords = words.filter(
      (w) => w.startMs >= seg.startMs && w.endMs <= seg.endMs
    ).length;

    const durationMin = (seg.endMs - seg.startMs) / 60000;
    if (durationMin > 0 && segWords > 0) {
      segmentWpms.push(segWords / durationMin);
    }
  }

  if (segmentWpms.length < 2) return null;

  const mean = segmentWpms.reduce((a, b) => a + b, 0) / segmentWpms.length;
  const variance = segmentWpms.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / segmentWpms.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 1; // coefficient of variation

  // Lower CV = more consistent. CV of 0.1 = ~95, 0.2 = ~85, 0.3 = ~70
  return Math.round(Math.max(0, 100 - cv * 250));
}

/**
 * Compute composure: based on hesitations, fillers, and restarts
 * Detects: "um", "uh", "er", "ah", repeated words, long pauses (>2s) mid-sentence
 */
export function computeComposure(
  transcript: string,
  words: WordTiming[],
  segments: SegmentTiming[]
): number {
  let score = 100;

  // Filler words
  const fillers = /\b(um|uh|er|ah|like|you know|i mean|sort of|kind of|actually|basically)\b/gi;
  const fillerMatches = transcript.match(fillers)?.length ?? 0;
  score -= Math.min(30, fillerMatches * 5);

  // Repeated words (immediate repetition)
  const wordList = transcript.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  let repeats = 0;
  for (let i = 1; i < wordList.length; i++) {
    const curr = wordList[i];
    const prev = wordList[i - 1];
    if (curr && prev && curr === prev && curr.length > 2) repeats++;
  }
  score -= Math.min(20, repeats * 4);

  // Long pauses mid-sentence (>2s between words in same segment)
  let longPauses = 0;
  for (const seg of segments) {
    const segWords = words
      .filter((w) => w.startMs >= seg.startMs && w.endMs <= seg.endMs)
      .sort((a, b) => a.startMs - b.startMs);
    for (let i = 1; i < segWords.length; i++) {
      const curr = segWords[i];
      const prev = segWords[i - 1];
      if (curr && prev) {
        const gap = curr.startMs - prev.endMs;
        if (gap > 2000) longPauses++;
      }
    }
  }
  score -= Math.min(25, longPauses * 8);

  // Very short turns (< 3 words) suggest hesitation
  if (wordList.length < 3) score -= 15;

  return Math.max(0, Math.round(score));
}

/**
 * Compute accuracy: vocabulary/grammar coverage for the learner's level.
 * This is a simplified heuristic - in production would use a language model
 * to compare against CEFR level expectations.
 */
export function computeAccuracy(
  transcript: string,
  words: WordTiming[],
  _nativeLanguage: string
): number {
  // Simplified: based on word count, sentence complexity, and error heuristics
  const wordCount = transcript.trim().split(/\s+/).filter((w) => w.length > 0).length;
  const sentenceCount = transcript.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;

  let score = 50; // baseline

  // Reward reasonable length
  if (wordCount >= 10) score += 15;
  else if (wordCount >= 5) score += 8;
  else score -= 10;

  // Reward multiple sentences (shows grammatical structure)
  if (sentenceCount >= 2) score += 10;
  else if (sentenceCount >= 1) score += 5;

  // Penalize very long run-on sentences
  if (sentenceCount === 1 && wordCount > 30) score -= 10;

  // Confidence-weighted word accuracy
  const confWords = words.filter((w) => (w.confidence ?? 1) > 0.5);
  if (confWords.length > 0) {
    const avgConf = confWords.reduce((s, w) => s + (w.confidence ?? 1), 0) / confWords.length;
    score += Math.round((avgConf - 0.5) * 40); // up to +20
  }

  // Language-specific adjustments (placeholder for future enhancement)
  // e.g., common Indian English patterns that aren't "errors"

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Main SCI computation function.
 *
 * Returns the SCI score (0-100), individual components, and evidence references.
 * Each component that contributes to the score MUST have evidence linking back
 * to the stored turn data.
 */
export function computeSCI(
  transcript: string,
  words: WordTiming[],
  segments: SegmentTiming[],
  totalTurnMs: number,
  nativeLanguage: string = 'en'
): SciResult {
  const components: SciComponents = {
    accuracy: computeAccuracy(transcript, words, nativeLanguage),
    range: computeRange(words),
    fluency: computeFluency(words, totalTurnMs),
    continuity: computeContinuity(segments, words),
    composure: computeComposure(transcript, words, segments),
  };

  // Weights per component (must sum to 1)
  const weights: Record<keyof SciComponents, number> = {
    accuracy: 0.25,
    range: 0.15,
    fluency: 0.20,
    continuity: 0.20,
    composure: 0.20,
  };

  // Determine which components are available
  const available = (Object.keys(components) as (keyof SciComponents)[]).filter(
    (k) => components[k] !== null
  );

  // Renormalise weights over available components
  const totalWeight = available.reduce((sum, k) => sum + weights[k], 0);
  const normalizedWeights: Record<keyof SciComponents, number> = {} as Record<keyof SciComponents, number>;
  for (const k of available) {
    normalizedWeights[k] = weights[k] / totalWeight;
  }

  // Compute weighted SCI
  const sci = available.reduce((sum, k) => sum + (components[k] ?? 0) * normalizedWeights[k], 0);

  return {
    sci: Math.round(sci),
    components,
    formulaVersion: SCI_FORMULA_VERSION,
    computedAt: new Date(),
    availableComponents: available,
    evidence: {
      accuracy: 'transcript word count, sentence structure, STT confidence',
      range: words.length ? 'type-token ratio from word timestamps' : undefined,
      fluency: words.length ? 'speech time / total turn time from word timestamps' : undefined,
      continuity: segments.length >= 2 ? 'WPM variance across segments' : undefined,
      composure: 'filler count, word repetitions, pause analysis from transcript + timestamps',
    },
  };
}

/**
 * Compute session-level summary from turn metrics.
 */
export interface SessionSummaryInput {
  turnMetrics: Array<{
    sci: number | null;
    fluency: number | null;
    accuracy: number | null;
    composure: number | null;
  }>;
  totalUserSpeechMs: number;
  turnCount: number;
}

export function computeSessionSummary(input: SessionSummaryInput) {
  const { turnMetrics, totalUserSpeechMs, turnCount } = input;

  const validSci = turnMetrics.map((m) => m.sci).filter((s): s is number => s !== null);
  const validFluency = turnMetrics.map((m) => m.fluency).filter((f): f is number => f !== null);
  const validAccuracy = turnMetrics.map((m) => m.accuracy).filter((a): a is number => a !== null);
  const validComposure = turnMetrics.map((m) => m.composure).filter((c): c is number => c !== null);

  const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);

  // Determine CEFR-ish level from average SCI
  let level: string | undefined;
  const avgSci = avg(validSci);
  if (avgSci !== null) {
    if (avgSci >= 85) level = 'C1';
    else if (avgSci >= 70) level = 'B2';
    else if (avgSci >= 55) level = 'B1';
    else if (avgSci >= 40) level = 'A2';
    else level = 'A1';
  }

  return {
    totalTurns: turnCount,
    totalUserSpeechMs,
    avgSci,
    avgFluency: avg(validFluency),
    avgAccuracy: avg(validAccuracy),
    avgComposure: avg(validComposure),
    level,
    formulaVersion: SCI_FORMULA_VERSION,
    generatedAt: new Date(),
  };
}