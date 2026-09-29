import type { FreeQuota, ProviderKind } from '@speaking-coach/shared';

/**
 * Free-tier numbers, copied by hand from each provider's official documentation.
 *
 * Rules for this file:
 *   - Every entry has a `source` that is the provider's own docs and a
 *     `verifiedOn` date. If a number cannot be found in the official docs, it is
 *     NOT recorded here and the provider is marked as having no published limit.
 *   - `requiresCard: true` means the provider is never part of a default chain.
 *   - When these numbers change, update the date and the tests in
 *     `test/freeTiers.test.ts` will flag anything inconsistent.
 */
export const FREE_TIERS = {
  'groq-llm': {
    plan: 'Free tier (no card)',
    requiresCard: false,
    limits: [
      { unit: 'requests', window: 'minute', limit: 30 },
      { unit: 'requests', window: 'day', limit: 1_000 },
      { unit: 'total_tokens', window: 'minute', limit: 8_000 },
      { unit: 'total_tokens', window: 'day', limit: 200_000 },
    ],
    source: 'https://console.groq.com/docs/rate-limits',
    verifiedOn: '2026-09-30',
    notes:
      'Organisation-level: shared by every key in the organisation. Cached prompt tokens are not billed. Responses carry x-ratelimit-* headers and retry-after, which the Quota Governor records to keep our own ledger honest.',
  },
  'groq-stt': {
    plan: 'Free tier (no card)',
    requiresCard: false,
    limits: [
      { unit: 'requests', window: 'minute', limit: 20 },
      { unit: 'requests', window: 'day', limit: 2_000 },
      { unit: 'audio_seconds', window: 'hour', limit: 7_200 },
      { unit: 'audio_seconds', window: 'day', limit: 28_800 },
    ],
    source: 'https://console.groq.com/docs/speech-to-text',
    verifiedOn: '2026-09-30',
    notes:
      'Maximum file size 25 MB. Minimum billed duration is 10 s. The free tier supports verbose_json with word and segment timestamp granularities, which is what the pause and response-delay metrics need.',
  },
  'groq-tts': {
    plan: 'Free tier (no card)',
    requiresCard: false,
    limits: [
      { unit: 'requests', window: 'minute', limit: 10 },
      { unit: 'requests', window: 'day', limit: 1_000 },
      { unit: 'total_tokens', window: 'minute', limit: 1_200 },
      { unit: 'total_tokens', window: 'day', limit: 3_600 },
    ],
    source: 'https://console.groq.com/docs/text-to-speech',
    verifiedOn: '2026-09-30',
    notes:
      'This is why Groq speech is only a fallback voice: 10 requests per minute cannot carry a live conversation, and the on-device voice is the primary path.',
  },
  'workersai-llm': {
    plan: 'Workers AI free allocation',
    requiresCard: false,
    limits: [{ unit: 'neurons', window: 'day', limit: 10_000 }],
    source: 'https://developers.cloudflare.com/workers-ai/platform/pricing/',
    verifiedOn: '2026-09-30',
    notes:
      'Daily neuron allocation shared by all models. gpt-oss-20b is billed at roughly 18,182 neurons per million input tokens and 27,273 per million output tokens, so the allocation converts to about 0.5M input tokens per day.',
  },
  'workersai-stt': {
    plan: 'Workers AI free allocation',
    requiresCard: false,
    limits: [{ unit: 'neurons', window: 'day', limit: 10_000 }],
    source: 'https://developers.cloudflare.com/workers-ai/models/whisper/',
    verifiedOn: '2026-09-30',
    notes:
      'The whisper model costs about 41.14 neurons per audio minute, which turns the daily allocation into roughly 240 audio minutes per day across all learners.',
  },
  'gemini-llm': {
    plan: 'Free tier (opt-in)',
    requiresCard: false,
    limits: [],
    source: 'https://ai.google.dev/gemini-api/docs/rate-limits',
    verifiedOn: '2026-09-30',
    notes:
      'No numeric limits are published; they are only visible per project in AI Studio and reset at midnight Pacific. Kept out of the default chain because Google states free-tier content may be used to improve their products, which is a decision for the operator, not for us.',
  },
  'gemini-tts': {
    plan: 'Free tier (opt-in)',
    requiresCard: false,
    limits: [],
    source: 'https://ai.google.dev/gemini-api/docs/speech-generation',
    verifiedOn: '2026-09-30',
    notes:
      'Free tier exists but the published numeric quota is not in the speech generation guide, so we cannot budget against it. Opt-in only, for the same content-usage reason as gemini-llm.',
  },
  'openrouter-llm': {
    plan: 'Free models',
    requiresCard: false,
    limits: [
      { unit: 'requests', window: 'minute', limit: 20 },
      { unit: 'requests', window: 'day', limit: 50 },
    ],
    source: 'https://openrouter.ai/docs/api/reference/limits',
    verifiedOn: '2026-09-30',
    notes:
      'The 50 requests/day applies to :free models while lifetime credits stay under $10, rising to 1,000/day afterwards. The exact remaining count is readable from GET /api/v1/key -> free_model_daily_requests, which the governor records.',
  },
  'azure-stt': {
    plan: 'F0 (opt-in, card required)',
    requiresCard: true,
    limits: [{ unit: 'audio_minutes', window: 'month', limit: 300 }],
    source:
      'https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits',
    verifiedOn: '2026-09-30',
    notes:
      'F0 gives 5 audio hours per month, but real-time streaming STT on F0 allows exactly one concurrent session and that cannot be raised, which makes it unusable as a live backend. Azure accounts also require card verification, so this provider is never in a default chain.',
  },
  'azure-tts': {
    plan: 'F0 (opt-in, card required)',
    requiresCard: true,
    limits: [
      { unit: 'characters', window: 'month', limit: 500_000 },
      { unit: 'requests', window: 'minute', limit: 20 },
    ],
    source: 'https://azure.microsoft.com/en-in/pricing/details/cognitive-services/speech-services/',
    verifiedOn: '2026-09-30',
    notes:
      '0.5M characters per month and 20 transactions per minute. Requires card verification for the Azure account.',
  },
  'ollama-llm': {
    plan: 'Self-hosted',
    requiresCard: false,
    limits: [],
    source: 'https://github.com/ollama/ollama/blob/main/docs/api.md',
    verifiedOn: '2026-09-30',
    notes:
      'Runs on hardware we already own, so it has no external quota at all. Only reachable when OLLAMA_BASE_URL points at a host we control; it is the last link in a chain, never a dependency.',
  },
} satisfies Record<string, FreeQuota>;

export type FreeTierProviderId = keyof typeof FREE_TIERS;

export function freeQuotaFor(providerId: string): FreeQuota | null {
  return Object.prototype.hasOwnProperty.call(FREE_TIERS, providerId)
    ? (FREE_TIERS[providerId as FreeTierProviderId] as FreeQuota)
    : null;
}

/** Extra official reading for context, shown in docs and the CLI health report. */
export const PROVIDER_DOC_LINKS: Record<string, { title: string; url: string }[]> = {
  'groq-llm': [
    { title: 'Groq rate limits', url: 'https://console.groq.com/docs/rate-limits' },
    { title: 'Groq text to speech', url: 'https://console.groq.com/docs/text-to-speech' },
  ],
  'groq-stt': [
    { title: 'Groq speech to text', url: 'https://console.groq.com/docs/speech-to-text' },
  ],
  'workersai-llm': [
    { title: 'Workers AI pricing', url: 'https://developers.cloudflare.com/workers-ai/platform/pricing/' },
    { title: 'Workers platform limits', url: 'https://developers.cloudflare.com/workers/platform/limits/' },
  ],
  'workersai-stt': [{ title: 'Whisper on Workers AI', url: 'https://developers.cloudflare.com/workers-ai/models/whisper/' }],
  'gemini-llm': [{ title: 'Gemini API rate limits', url: 'https://ai.google.dev/gemini-api/docs/rate-limits' }],
  'gemini-tts': [
    { title: 'Gemini speech generation', url: 'https://ai.google.dev/gemini-api/docs/speech-generation' },
  ],
  'openrouter-llm': [{ title: 'OpenRouter limits', url: 'https://openrouter.ai/docs/api/reference/limits' }],
  'azure-stt': [
    {
      title: 'Azure Speech quotas and limits',
      url: 'https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits',
    },
  ],
  'azure-tts': [
    {
      title: 'Azure Speech pricing',
      url: 'https://azure.microsoft.com/en-in/pricing/details/cognitive-services/speech-services/',
    },
  ],
  'ollama-llm': [{ title: 'Ollama API', url: 'https://github.com/ollama/ollama/blob/main/docs/api.md' }],
};

/** Which provider serves which capability. Kept next to the quota table on purpose. */
export const PROVIDER_KIND_BY_ID: Record<string, ProviderKind> = {
  'groq-llm': 'llm',
  'groq-stt': 'stt',
  'groq-tts': 'tts',
  'workersai-llm': 'llm',
  'workersai-stt': 'stt',
  'gemini-llm': 'llm',
  'gemini-tts': 'tts',
  'openrouter-llm': 'llm',
  'azure-stt': 'stt',
  'azure-tts': 'tts',
  'ollama-llm': 'llm',
};
