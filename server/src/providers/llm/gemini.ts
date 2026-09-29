import type { ProviderCapabilities } from '@speaking-coach/shared';
import { freeQuotaFor } from '../../config/freeTiers';
import { env } from '../../env';
import { parseJson, providerRequest } from '../http';
import type { LLMProvider, LLMRequest, LLMResponse, ProviderHealth } from '../types';

/**
 * Google Gemini.
 *
 * Deliberately NOT in the default chain. Two reasons, both from Google's own
 * documentation (checked 2026-09-30):
 *   - https://ai.google.dev/gemini-api/docs/rate-limits publishes no numeric free
 *     tier limits. They are only visible per project in AI Studio, so we cannot
 *     budget against them and cannot promise a capacity number to anyone.
 *   - https://ai.google.dev/gemini-api/docs/pricing states that free-tier content
 *     may be used to improve Google's products. That is the operator's decision to
 *     make, not ours, so it stays opt-in behind an environment variable.
 */

const id = 'gemini-llm';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiGenerateResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number };
}

function apiKey(): string | undefined {
  return env().GEMINI_API_KEY;
}

function model(): string | undefined {
  return env().GEMINI_LLM_MODEL;
}

const capabilities: ProviderCapabilities = {
  id,
  kind: 'llm',
  wordTimestamps: false,
  streaming: true,
  pronunciationScoring: false,
  onDevice: false,
  freeQuota: freeQuotaFor(id),
  description: 'Gemini chat. Opt-in only: no published numeric free limits.',
};

export const geminiLlm: LLMProvider = {
  id,
  kind: 'llm',
  capabilities,

  isConfigured(): boolean {
    return Boolean(apiKey() && model());
  },

  configurationHint(): string | null {
    if (!apiKey()) return 'Set GEMINI_API_KEY to enable Gemini.';
    if (!model()) return 'Set GEMINI_LLM_MODEL to the model id you have checked on the Gemini pricing page.';
    return null;
  },

  async healthCheck(options: { deep: boolean }): Promise<ProviderHealth> {
    if (!geminiLlm.isConfigured()) {
      return {
        id,
        kind: 'llm',
        status: 'unconfigured',
        detail: geminiLlm.configurationHint() ?? 'Not configured.',
        latencyMs: null,
        checkedAt: new Date().toISOString(),
        rateLimitHeaders: null,
        deep: false,
      };
    }
    if (!options.deep) {
      // The models endpoint is free and tells us whether the key is valid.
      const started = Date.now();
      try {
        const result = await providerRequest(
          `${BASE_URL}/models?key=${encodeURIComponent(apiKey() ?? '')}`,
          { method: 'GET' },
          { providerId: id, timeoutMs: 8_000, retries: 0 },
        );
        const body = parseJson<{ models?: unknown[] }>(result, id);
        return {
          id,
          kind: 'llm',
          status: 'ok',
          detail: `Key accepted: ${body.models?.length ?? 0} models listed.`,
          latencyMs: Date.now() - started,
          checkedAt: new Date().toISOString(),
          rateLimitHeaders: result.rateLimitHeaders,
          deep: false,
        };
      } catch (error) {
        return {
          id,
          kind: 'llm',
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
      const response = await geminiLlm.complete({
        system: 'You reply with one word.',
        prompt: 'Reply with the word: ready',
        maxOutputTokens: 8,
        purpose: 'probe',
      });
      return {
        id,
        kind: 'llm',
        status: 'ok',
        detail: `Answered a live request using ${response.model}.`,
        latencyMs: response.latencyMs,
        checkedAt: new Date().toISOString(),
        rateLimitHeaders: response.rateLimitHeaders,
        deep: true,
      };
    } catch (error) {
      return {
        id,
        kind: 'llm',
        status: 'unreachable',
        detail: `Live request failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        latencyMs: null,
        checkedAt: new Date().toISOString(),
        rateLimitHeaders: null,
        deep: true,
      };
    }
  },

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const chosenModel = request.model ?? model() ?? '';
    const result = await providerRequest(
      `${BASE_URL}/models/${encodeURIComponent(chosenModel)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': request.userApiKey ?? apiKey() ?? '',
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
          generationConfig: {
            maxOutputTokens: request.maxOutputTokens,
            temperature: request.temperature ?? 0.7,
          },
        }),
      },
      { providerId: id, timeoutMs: 25_000, retries: 1, signal: request.signal },
    );

    const body = parseJson<GeminiGenerateResponse>(result, id);
    const text =
      body.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? '')
        .join('')
        .trim() ?? '';
    return {
      providerId: id,
      model: chosenModel,
      text,
      inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
      cached: (body.usageMetadata?.cachedContentTokenCount ?? 0) > 0,
      finishReason: body.candidates?.[0]?.finishReason ?? null,
      latencyMs: result.latencyMs,
      rateLimitHeaders: result.rateLimitHeaders,
    };
  },
};
