import type { ProviderCapabilities } from '@speaking-coach/shared';
import { freeQuotaFor } from '../../config/freeTiers';
import { env } from '../../env';
import { parseJson, providerRequest } from '../http';
import type { LLMProvider, LLMRequest, LLMResponse, ProviderHealth } from '../types';

/**
 * Ollama on hardware we control.
 *
 * No external quota at all, which makes it the ideal tail of a chain. It only
 * works when OLLAMA_BASE_URL points at a machine we run, so it is never a
 * dependency: if it is not configured, the chain simply ends before it.
 */

const id = 'ollama-llm';

interface OllamaChatResponse {
  message?: { content?: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

function baseUrl(): string | undefined {
  return env().OLLAMA_BASE_URL;
}

const capabilities: ProviderCapabilities = {
  id,
  kind: 'llm',
  wordTimestamps: false,
  streaming: true,
  pronunciationScoring: false,
  onDevice: false,
  freeQuota: freeQuotaFor(id),
  description: 'A model running on our own machine. Zero external quota when available.',
};

export const ollamaLlm: LLMProvider = {
  id,
  kind: 'llm',
  capabilities,

  isConfigured(): boolean {
    return Boolean(baseUrl());
  },

  configurationHint(): string | null {
    return baseUrl() ? null : 'Set OLLAMA_BASE_URL to a machine you control that runs Ollama.';
  },

  async healthCheck(_options: { deep: boolean }): Promise<ProviderHealth> {
    if (!ollamaLlm.isConfigured()) {
      return {
        id,
        kind: 'llm',
        status: 'unconfigured',
        detail: ollamaLlm.configurationHint() ?? 'Not configured.',
        latencyMs: null,
        checkedAt: new Date().toISOString(),
        rateLimitHeaders: null,
        deep: false,
      };
    }
    const started = Date.now();
    try {
      const result = await providerRequest(
        `${baseUrl()}/api/tags`,
        { method: 'GET' },
        { providerId: id, timeoutMs: 5_000, retries: 0 },
      );
      const body = parseJson<OllamaTagsResponse>(result, id);
      const wanted = env().OLLAMA_LLM_MODEL;
      const present = body.models?.some((model) => model.name?.startsWith(wanted.split(':')[0] ?? '')) ?? false;
      return {
        id,
        kind: 'llm',
        status: 'ok',
        detail: present
          ? `Reachable and ${wanted} is pulled.`
          : `Reachable, but ${wanted} is not pulled yet. Run: ollama pull ${wanted}`,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
        rateLimitHeaders: null,
        deep: false,
      };
    } catch (error) {
      return {
        id,
        kind: 'llm',
        status: 'unreachable',
        detail: `Could not reach Ollama: ${error instanceof Error ? error.message : 'unknown error'}`,
        latencyMs: null,
        checkedAt: new Date().toISOString(),
        rateLimitHeaders: null,
        deep: false,
      };
    }
  },

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model ?? env().OLLAMA_LLM_MODEL;
    const result = await providerRequest(
      `${baseUrl()}/api/chat`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.prompt },
          ],
          options: {
            temperature: request.temperature ?? 0.7,
            num_predict: request.maxOutputTokens,
          },
        }),
      },
      { providerId: id, timeoutMs: 60_000, retries: 1, signal: request.signal },
    );
    const body = parseJson<OllamaChatResponse>(result, id);
    return {
      providerId: id,
      model,
      text: (body.message?.content ?? '').trim(),
      inputTokens: body.prompt_eval_count ?? 0,
      outputTokens: body.eval_count ?? 0,
      cached: false,
      finishReason: body.done_reason ?? null,
      latencyMs: result.latencyMs,
      rateLimitHeaders: {},
    };
  },
};
