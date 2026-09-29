import type { ProviderCapabilities, ProviderKind } from '@speaking-coach/shared';

/**
 * Provider contracts.
 *
 * Everything the product needs from a speech or language service is expressed
 * here, plus a capability descriptor. The UI and the metrics pipeline read the
 * descriptor rather than guessing, so a missing capability degrades to "Not
 * assessed" instead of a fabricated number.
 */

/**
 * What a call is for. The Quota Governor uses this to decide priority: an
 * interview mock must keep working when shared free capacity is tight, and a
 * background probe must never take budget from a learner.
 */
export type QuotaPurpose = 'conversation' | 'interview' | 'evaluation' | 'probe' | 'cached_audio';

export const QUOTA_PURPOSE_PRIORITY: Record<QuotaPurpose, number> = {
  interview: 0,
  conversation: 1,
  evaluation: 2,
  cached_audio: 3,
  probe: 4,
};

export type ProviderHealthStatus =
  | 'ok'
  | 'unconfigured'
  | 'unreachable'
  | 'rejected'
  | 'limited'
  | 'unknown';

export interface ProviderHealth {
  id: string;
  kind: ProviderKind;
  status: ProviderHealthStatus;
  /** One plain sentence, safe to show a learner or an operator. */
  detail: string;
  latencyMs: number | null;
  checkedAt: string;
  rateLimitHeaders: Record<string, string> | null;
  /** True when the check made a real billed inference rather than a metadata call. */
  deep: boolean;
}

export interface ProviderCallContext {
  /** Supplied by the learner through bring-your-own-key; never logged. */
  userApiKey?: string | undefined;
  signal?: AbortSignal | undefined;
  purpose?: QuotaPurpose | undefined;
}

export interface BaseProvider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly capabilities: ProviderCapabilities;
  /** True when the credentials this provider needs are present. */
  isConfigured(): boolean;
  /** Why it is not configured, in plain language. Null when it is configured. */
  configurationHint(): string | null;
  healthCheck(options: { deep: boolean }): Promise<ProviderHealth>;
}

export interface LLMRequest extends ProviderCallContext {
  system: string;
  prompt: string;
  maxOutputTokens: number;
  temperature?: number;
  model?: string;
}

export interface LLMResponse {
  providerId: string;
  model: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** True when the provider reported a cache hit, which many free tiers do not bill. */
  cached: boolean;
  finishReason: string | null;
  latencyMs: number;
  rateLimitHeaders: Record<string, string>;
}

export interface LLMProvider extends BaseProvider {
  readonly kind: 'llm';
  complete(request: LLMRequest): Promise<LLMResponse>;
}

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
  /** Provider confidence, when available. Below the threshold the word is not judged. */
  confidence: number | null;
}

export interface SegmentTiming {
  text: string;
  startMs: number;
  endMs: number;
  noSpeechProbability: number | null;
}

export interface STTRequest extends ProviderCallContext {
  audio: Buffer;
  contentType: string;
  language?: string;
  /** Optional context words that help a free tier transcribe names correctly. */
  prompt?: string;
}

export interface STTResult {
  providerId: string;
  text: string;
  /** Empty when the provider cannot do word timings; metrics then report unavailable. */
  words: WordTiming[];
  segments: SegmentTiming[];
  language: string | null;
  audioDurationMs: number | null;
  latencyMs: number;
  rateLimitHeaders: Record<string, string>;
}

export interface SpeechToTextProvider extends BaseProvider {
  readonly kind: 'stt';
  transcribe(request: STTRequest): Promise<STTResult>;
}

export type TTSAudioFormat = 'mp3' | 'wav' | 'pcm';

export interface TTSRequest extends ProviderCallContext {
  text: string;
  voice?: string;
  format?: TTSAudioFormat;
  speed?: number;
}

export interface TTSResult {
  providerId: string;
  audio: Buffer;
  contentType: string;
  bytes: number;
  characters: number;
  /** True when the audio came from our cache and cost nothing to produce. */
  cached: boolean;
  latencyMs: number;
  rateLimitHeaders: Record<string, string>;
}

export interface TextToSpeechProvider extends BaseProvider {
  readonly kind: 'tts';
  synthesize(request: TTSRequest): Promise<TTSResult>;
}

/**
 * Pronunciation scoring deliberately has no server implementation.
 *
 * Every pronunciation-assessment service we checked is billed as a paid add-on
 * with no free allowance, so shipping one would break the free-forever promise or
 * require inventing a score. The interface stays defined so the capability can be
 * added later behind an env-var swap without touching the metrics pipeline.
 */
export type PronunciationUnavailableReason =
  | 'no_free_provider_exists'
  | 'not_configured'
  | 'disabled_by_operator';

export const PRONUNCIATION_AVAILABILITY = {
  available: false,
  reason: 'no_free_provider_exists' as PronunciationUnavailableReason,
  uiLabel: 'Not assessed',
  detail:
    'No pronunciation-assessment service has a free allowance, so pronunciation is not scored. Nothing here guesses at it.',
} as const;
