/**
 * Provider capability model.
 *
 * Every provider (on-device or server-side) advertises what it can actually do.
 * The UI is built from these descriptors: if a capability is false, the feature is
 * hidden or shown as "Not assessed". We never pretend a capability exists.
 */

export const PROVIDER_KINDS = ['stt', 'tts', 'llm', 'pronunciation'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export type QuotaWindow = 'second' | 'minute' | 'hour' | 'day' | 'month';

export type QuotaUnit =
  | 'requests'
  | 'input_tokens'
  | 'output_tokens'
  | 'total_tokens'
  | 'characters'
  | 'audio_seconds'
  | 'audio_minutes'
  | 'neurons'
  | 'concurrent_sessions';

/** A single hard limit taken from the provider's official free-tier documentation. */
export interface FreeQuotaLimit {
  /** What is being counted, e.g. "requests" or "audio_seconds". */
  unit: QuotaUnit;
  window: QuotaWindow;
  limit: number;
  /** Set when the free plan has no allowance at all for this unit. */
  unlimited?: boolean;
}

export interface FreeQuota {
  /** Human readable plan name, e.g. "Free tier". */
  plan: string;
  limits: FreeQuotaLimit[];
  /**
   * True when the provider asks for a payment card to create or use the free
   * account. Providers with `requiresCard: true` are never part of a default
   * chain, because "free forever" must not risk an unexpected bill.
   */
  requiresCard: boolean;
  /** Official documentation URL. Never a blog post or an aggregator. */
  source: string;
  /** ISO date (YYYY-MM-DD) on which the numbers above were checked by hand. */
  verifiedOn: string;
  /** Anything that qualifies the numbers (org-level vs project-level, etc.). */
  notes?: string;
}

export interface ProviderCapabilities {
  /** Stable identifier used in configuration, logs and the health endpoint. */
  id: string;
  kind: ProviderKind;
  /** True when speech-to-text returns per-word start/end times. */
  wordTimestamps: boolean;
  /** True when tokens/partial results can be consumed incrementally. */
  streaming: boolean;
  /** True when the provider returns a pronunciation score of its own. */
  pronunciationScoring: boolean;
  /** True when inference happens on the learner's device (no server quota). */
  onDevice: boolean;
  /** Free allowance for this provider, or null when there is no server-side quota. */
  freeQuota: FreeQuota | null;
  /** One short sentence shown in the provider health panel. */
  description: string;
}

/**
 * Pronunciation scoring status for the whole product.
 *
 * Every pronunciation-scoring provider we checked (Azure Pronunciation Assessment)
 * is billed as a paid add-on with no free allowance, so on free tiers we have no
 * real scoring source. The honest default is therefore "not assessed" rather than
 * a self-invented number. See docs/free-tiers.md for the pricing citations.
 */
export const PRONUNCIATION_ASSESSMENT_STATUS = {
  available: false,
  reason:
    'No pronunciation-assessment provider offers a free allowance. Pronunciation is not scored by default.',
  /** Shown verbatim in the UI wherever a pronunciation number would appear. */
  uiLabel: 'Not assessed',
} as const;

/**
 * Client-side (on-device) capabilities. These run inside the browser, consume no
 * server quota and are probed at runtime because support varies by device.
 */
export const ON_DEVICE_CAPABILITIES = {
  whisper: {
    id: 'local-whisper',
    kind: 'stt' as ProviderKind,
    model: 'onnx-community/whisper-base',
    /** Approximate first-load download size in megabytes. */
    approxDownloadMb: 80,
    requiresWebGpuPreferred: true,
    description:
      'Speech-to-text in your browser using WebGPU, falling back to WASM. Audio never leaves the device.',
  },
  kokoro: {
    id: 'local-kokoro',
    kind: 'tts' as ProviderKind,
    model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    approxDownloadMb: 86,
    description:
      'Natural voice replies generated in your browser. Nothing is sent to a speech service.',
  },
  sileroVad: {
    id: 'local-silero-vad',
    kind: 'vad' as ProviderKind,
    model: 'onnx-community/silero-vad',
    approxDownloadMb: 2,
    description: 'Detects when you stop talking so replies start without you pressing anything.',
  },
  webSpeechCaptions: {
    id: 'browser-webspeech',
    kind: 'stt' as ProviderKind,
    /** Captions only: it is never used for metrics, scoring or transcripts of record. */
    captionOnly: true,
    description:
      'Your browser\'s own speech service. Used for live captions only, never for scores.',
  },
} as const;
