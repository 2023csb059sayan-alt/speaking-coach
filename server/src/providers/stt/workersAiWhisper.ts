import type { ProviderCapabilities } from '@speaking-coach/shared';
import { freeQuotaFor } from '../../config/freeTiers';
import { env } from '../../env';
import { parseJson, providerRequest } from '../http';
import type {
  ProviderHealth,
  SpeechToTextProvider,
  STTRequest,
  STTResult,
  SegmentTiming,
} from '../types';

/**
 * Whisper on Cloudflare Workers AI.
 *
 * Free allocation (verified 2026-09-30,
 * https://developers.cloudflare.com/workers-ai/models/whisper/): the model costs
 * about 41.14 neurons per audio minute out of a 10,000 neuron daily allocation,
 * which works out to roughly 240 audio minutes per day for every learner combined.
 *
 * The endpoint takes raw audio bytes and returns `{ text }`. It does not return word
 * timings, so any metric that needs them reports "not available" rather than
 * guessing. That difference is declared in the capability descriptor, which is why
 * the registry is ordered Groq first and this one second.
 */

const id = 'workersai-stt';
const MODEL = '@cf/openai/whisper';

interface WhisperResponse {
  result?: { text?: string };
  success?: boolean;
  errors?: Array<{ message?: string }>;
}

const capabilities: ProviderCapabilities = {
  id,
  kind: 'stt',
  wordTimestamps: false,
  streaming: false,
  pronunciationScoring: false,
  onDevice: false,
  freeQuota: freeQuotaFor(id),
  description: 'Transcription fallback on Cloudflare\'s edge. No word timings, so pause metrics pause too.',
};

function accountId(): string | undefined {
  return env().CLOUDFLARE_ACCOUNT_ID;
}

function token(): string | undefined {
  return env().CLOUDFLARE_AI_TOKEN;
}

export const workersAiStt: SpeechToTextProvider = {
  id,
  kind: 'stt',
  capabilities,

  isConfigured(): boolean {
    return Boolean(accountId() && token());
  },

  configurationHint(): string | null {
    if (!accountId()) return 'Set CLOUDFLARE_ACCOUNT_ID to use Workers AI transcription.';
    if (!token()) return 'Set CLOUDFLARE_AI_TOKEN to use Workers AI transcription.';
    return null;
  },

  async healthCheck(options: { deep: boolean }): Promise<ProviderHealth> {
    if (!workersAiStt.isConfigured()) {
      return {
        id,
        kind: 'stt',
        status: 'unconfigured',
        detail: workersAiStt.configurationHint() ?? 'Not configured.',
        latencyMs: null,
        checkedAt: new Date().toISOString(),
        rateLimitHeaders: null,
        deep: false,
      };
    }
    if (!options.deep) {
      const started = Date.now();
      try {
        const result = await providerRequest(
          `https://api.cloudflare.com/client/v4/accounts/${accountId()}`,
          { method: 'GET', headers: { authorization: `Bearer ${token() ?? ''}` } },
          { providerId: id, timeoutMs: 8_000, retries: 0 },
        );
        return {
          id,
          kind: 'stt',
          status: 'ok',
          detail: 'Account token accepted by Cloudflare.',
          latencyMs: Date.now() - started,
          checkedAt: new Date().toISOString(),
          rateLimitHeaders: result.rateLimitHeaders,
          deep: false,
        };
      } catch (error) {
        return {
          id,
          kind: 'stt',
          status: 'unreachable',
          detail: `Metadata call failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          latencyMs: null,
          checkedAt: new Date().toISOString(),
          rateLimitHeaders: null,
          deep: false,
        };
      }
    }
    const started = Date.now();
    try {
      const response = await workersAiStt.transcribe({
        audio: Buffer.alloc(0),
        contentType: 'application/octet-stream',
        purpose: 'probe',
      });
      return {
        id,
        kind: 'stt',
        status: 'ok',
        detail: `Endpoint responded in ${response.latencyMs}ms.`,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
        rateLimitHeaders: response.rateLimitHeaders,
        deep: true,
      };
    } catch (error) {
      return {
        id,
        kind: 'stt',
        status: 'unreachable',
        detail: `Live transcription failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        latencyMs: null,
        checkedAt: new Date().toISOString(),
        rateLimitHeaders: null,
        deep: true,
      };
    }
  },

  async transcribe(request: STTRequest): Promise<STTResult> {
    const result = await providerRequest(
      `https://api.cloudflare.com/client/v4/accounts/${accountId()}/ai/run/${encodeURIComponent(MODEL)}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${request.userApiKey ?? token() ?? ''}`,
          'content-type': request.contentType || 'application/octet-stream',
        },
        body: new Uint8Array(request.audio),
      },
      { providerId: id, timeoutMs: 30_000, retries: 1, signal: request.signal },
    );

    const body = parseJson<WhisperResponse>(result, id);
    if (body.success === false) {
      throw new Error(`${id} reported an error: ${body.errors?.[0]?.message ?? 'unknown'}`);
    }
    const text = (body.result?.text ?? '').trim();
    const segments: SegmentTiming[] = text ? [{ text, startMs: 0, endMs: 0, noSpeechProbability: null }] : [];
    return {
      providerId: id,
      text,
      words: [],
      segments,
      language: request.language ?? null,
      audioDurationMs: null,
      latencyMs: result.latencyMs,
      rateLimitHeaders: result.rateLimitHeaders,
    };
  },
};
