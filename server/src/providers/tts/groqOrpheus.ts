import type { ProviderCapabilities } from '@speaking-coach/shared';
import { freeQuotaFor } from '../../config/freeTiers';
import { env } from '../../env';
import { providerRequest } from '../http';
import type { ProviderHealth, TextToSpeechProvider, TTSRequest, TTSResult } from '../types';

/**
 * Groq speech, used as the last server-side voice.
 *
 * Free tier (verified 2026-09-30, https://console.groq.com/docs/text-to-speech):
 * 10 requests/minute, 1,000 requests/day, 1,200 tokens/minute and 3,600 tokens/day.
 * Ten requests a minute is nowhere near enough for a live conversation, which is
 * exactly why the browser's on-device voice is the primary path and this one is a
 * fallback for devices that cannot run it.
 */

const id = 'groq-tts';
const BASE_URL = 'https://api.groq.com/openai/v1';

const capabilities: ProviderCapabilities = {
  id,
  kind: 'tts',
  wordTimestamps: false,
  streaming: false,
  pronunciationScoring: false,
  onDevice: false,
  freeQuota: freeQuotaFor(id),
  description: 'Server-side voice fallback. Too small for live conversation, so it is never the first choice.',
};

function apiKey(): string | undefined {
  return env().GROQ_API_KEY;
}

export const groqTts: TextToSpeechProvider = {
  id,
  kind: 'tts',
  capabilities,

  isConfigured(): boolean {
    return Boolean(apiKey());
  },

  configurationHint(): string | null {
    return apiKey() ? null : 'Set GROQ_API_KEY to enable the server voice fallback.';
  },

  async healthCheck(options: { deep: boolean }): Promise<ProviderHealth> {
    if (!groqTts.isConfigured()) {
      return {
        id,
        kind: 'tts',
        status: 'unconfigured',
        detail: groqTts.configurationHint() ?? 'Not configured.',
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
          `${BASE_URL}/models`,
          { method: 'GET', headers: { authorization: `Bearer ${apiKey() ?? ''}` } },
          { providerId: id, timeoutMs: 8_000, retries: 0 },
        );
        return {
          id,
          kind: 'tts',
          status: 'ok',
          detail: 'Key accepted by Groq.',
          latencyMs: Date.now() - started,
          checkedAt: new Date().toISOString(),
          rateLimitHeaders: result.rateLimitHeaders,
          deep: false,
        };
      } catch (error) {
        return {
          id,
          kind: 'tts',
          status: 'unreachable',
          detail: `Metadata call failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          latencyMs: null,
          checkedAt: new Date().toISOString(),
          rateLimitHeaders: null,
          deep: false,
        };
      }
    }
    try {
      const response = await groqTts.synthesize({ text: 'Ready when you are.', purpose: 'probe' });
      return {
        id,
        kind: 'tts',
        status: 'ok',
        detail: `Spoke ${response.bytes} bytes in ${response.latencyMs}ms.`,
        latencyMs: response.latencyMs,
        checkedAt: new Date().toISOString(),
        rateLimitHeaders: response.rateLimitHeaders,
        deep: true,
      };
    } catch (error) {
      return {
        id,
        kind: 'tts',
        status: 'unreachable',
        detail: `Live synthesis failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        latencyMs: null,
        checkedAt: new Date().toISOString(),
        rateLimitHeaders: null,
        deep: true,
      };
    }
  },

  async synthesize(request: TTSRequest): Promise<TTSResult> {
    const result = await providerRequest(
      `${BASE_URL}/audio/speech`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${request.userApiKey ?? apiKey() ?? ''}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: env().GROQ_TTS_MODEL,
          voice: request.voice ?? 'playai-tara',
          input: request.text,
          response_format: request.format === 'wav' ? 'wav' : 'mp3',
          speed: request.speed ?? 1,
        }),
      },
      { providerId: id, timeoutMs: 30_000, retries: 1, signal: request.signal },
    );

    const bytes = result.bytes ?? Buffer.alloc(0);
    return {
      providerId: id,
      audio: bytes,
      contentType: result.headers.get('content-type') ?? 'audio/mpeg',
      bytes: bytes.length,
      characters: request.text.length,
      cached: false,
      latencyMs: result.latencyMs,
      rateLimitHeaders: result.rateLimitHeaders,
    };
  },
};
