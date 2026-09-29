import type { ProviderCapabilities } from '@speaking-coach/shared';
import { freeQuotaFor } from '../../config/freeTiers';
import { env } from '../../env';
import { parseJson, providerRequest, ProviderHttpError } from '../http';
import type {
  ProviderHealth,
  SpeechToTextProvider,
  STTRequest,
  STTResult,
  SegmentTiming,
  WordTiming,
} from '../types';

/**
 * Groq Whisper, the server fallback when the browser cannot run speech-to-text
 * on-device.
 *
 * Free tier (verified 2026-09-30, https://console.groq.com/docs/speech-to-text):
 * 20 requests/minute, 2,000 requests/day, 7,200 audio seconds/hour and 28,800
 * audio seconds/day, 25 MB maximum file, 10 s minimum billed duration.
 *
 * We ask for `verbose_json` with word-level timestamps because pause counts,
 * response delay and speaking-time ratio are all derived from word timings. A
 * provider that cannot return them would make those metrics unavailable, and we
 * would rather show that than invent a number.
 */

const id = 'groq-stt';
const BASE_URL = 'https://api.groq.com/openai/v1';

interface GroqTranscriptionResponse {
  text?: string;
  language?: string;
  duration?: number;
  words?: Array<{ word?: string; start?: number; end?: number }>;
  segments?: Array<{ text?: string; start?: number; end?: number; no_speech_prob?: number }>;
}

const capabilities: ProviderCapabilities = {
  id,
  kind: 'stt',
  wordTimestamps: true,
  streaming: false,
  pronunciationScoring: false,
  onDevice: false,
  freeQuota: freeQuotaFor(id),
  description: 'Server-side transcription with word timings, used when on-device speech recognition is unavailable.',
};

function apiKey(): string | undefined {
  return env().GROQ_API_KEY;
}

export const groqStt: SpeechToTextProvider = {
  id,
  kind: 'stt',
  capabilities,

  isConfigured(): boolean {
    return Boolean(apiKey());
  },

  configurationHint(): string | null {
    return apiKey() ? null : 'Set GROQ_API_KEY to enable the server transcription fallback.';
  },

  async healthCheck(options: { deep: boolean }): Promise<ProviderHealth> {
    if (!groqStt.isConfigured()) {
      return {
        id,
        kind: 'stt',
        status: 'unconfigured',
        detail: groqStt.configurationHint() ?? 'Not configured.',
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
          kind: 'stt',
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
    // Deep check sends 0.2 s of silence. Groq bills a 10 s minimum, so this costs
    // 10 audio seconds of the daily allowance and must not run on every request.
    try {
      const response = await groqStt.transcribe({
        audio: silentWav(),
        contentType: 'audio/wav',
        purpose: 'probe',
      });
      return {
        id,
        kind: 'stt',
        status: 'ok',
        detail: `Transcribed a 0.2s test clip in ${response.latencyMs}ms.`,
        latencyMs: response.latencyMs,
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
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(request.audio)], { type: request.contentType }), 'turn.webm');
    form.append('model', env().GROQ_STT_MODEL);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    if (request.language) form.append('language', request.language);
    if (request.prompt) form.append('prompt', request.prompt);

    const result = await providerRequest(
      `${BASE_URL}/audio/transcriptions`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${request.userApiKey ?? apiKey() ?? ''}` },
        body: form,
      },
      { providerId: id, timeoutMs: 30_000, retries: 1, signal: request.signal },
    );

    const body = parseJson<GroqTranscriptionResponse>(result, id);
    const words: WordTiming[] = (body.words ?? [])
      .filter((word) => typeof word.start === 'number' && typeof word.end === 'number')
      .map((word) => ({
        word: word.word ?? '',
        startMs: Math.round((word.start ?? 0) * 1000),
        endMs: Math.round((word.end ?? 0) * 1000),
        confidence: null,
      }));

    const segments: SegmentTiming[] = (body.segments ?? []).map((segment) => ({
      text: (segment.text ?? '').trim(),
      startMs: Math.round((segment.start ?? 0) * 1000),
      endMs: Math.round((segment.end ?? 0) * 1000),
      noSpeechProbability: typeof segment.no_speech_prob === 'number' ? segment.no_speech_prob : null,
    }));

    return {
      providerId: id,
      text: (body.text ?? '').trim(),
      words,
      segments,
      language: body.language ?? request.language ?? null,
      audioDurationMs: typeof body.duration === 'number' ? Math.round(body.duration * 1000) : null,
      latencyMs: result.latencyMs,
      rateLimitHeaders: result.rateLimitHeaders,
    };
  },
};

/** 0.2 seconds of silence as a 16 kHz mono PCM WAV, used only by the deep health probe. */
export function silentWav(milliseconds = 200): Buffer {
  const sampleRate = 16_000;
  const samples = Math.round((sampleRate * milliseconds) / 1000);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

/** True when an upstream failure is about quota rather than a broken request. */
export function isQuotaError(error: unknown): boolean {
  return error instanceof ProviderHttpError && error.isRateLimited;
}
