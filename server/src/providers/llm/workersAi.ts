import type { ProviderCapabilities } from '@speaking-coach/shared';
import { freeQuotaFor } from '../../config/freeTiers';
import { env } from '../../env';
import { parseJson, providerRequest } from '../http';
import type { LLMProvider, LLMRequest, LLMResponse, ProviderHealth } from '../types';

/**
 * Cloudflare Workers AI.
 *
 * Free allocation (verified 2026-09-30,
 * https://developers.cloudflare.com/workers-ai/platform/pricing/): 10,000 neurons
 * per day across all models. gpt-oss-20b costs roughly 18,182 neurons per million
 * input tokens, so the daily allocation is about half a million input tokens.
 *
 * The REST endpoint is https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{model}
 * and the request body follows the OpenAI chat shape, but the response is wrapped in
 * a `result` envelope, hence its own adapter.
 */

interface WorkersChatResponse {
  success?: boolean;
  result?: {
    choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  errors?: Array<{ message?: string }>;
}

const id = 'workersai-llm';

function accountId(): string | undefined {
  return env().CLOUDFLARE_ACCOUNT_ID;
}

function token(): string | undefined {
  return env().CLOUDFLARE_AI_TOKEN;
}

function runUrl(model: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId()}/ai/run/${encodeURIComponent(model)}`;
}

const capabilities: ProviderCapabilities = {
  id,
  kind: 'llm',
  wordTimestamps: false,
  streaming: false,
  pronunciationScoring: false,
  onDevice: false,
  freeQuota: freeQuotaFor(id),
  description: 'Runs an open model on Cloudflare\'s edge. Second fallback for the conversation brain.',
};

export const workersAiLlm: LLMProvider = {
  id,
  kind: 'llm',
  capabilities,

  isConfigured(): boolean {
    return Boolean(accountId() && token());
  },

  configurationHint(): string | null {
    if (!accountId()) return 'Set CLOUDFLARE_ACCOUNT_ID to use Workers AI.';
    if (!token()) return 'Set CLOUDFLARE_AI_TOKEN to use Workers AI.';
    return null;
  },

  async healthCheck(options: { deep: boolean }): Promise<ProviderHealth> {
    if (!workersAiLlm.isConfigured()) {
      return {
        id,
        kind: 'llm',
        status: 'unconfigured',
        detail: workersAiLlm.configurationHint() ?? 'Not configured.',
        latencyMs: null,
        checkedAt: new Date().toISOString(),
        rateLimitHeaders: null,
        deep: false,
      };
    }
    if (options.deep) {
      try {
        const response = await workersAiLlm.complete({
          system: 'You reply with one word.',
          prompt: 'Reply with the word: ready',
          maxOutputTokens: 4,
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
    }
    const started = Date.now();
    const result = await providerRequest(
      `https://api.cloudflare.com/client/v4/accounts/${accountId()}`,
      { method: 'GET', headers: { authorization: `Bearer ${token()}` } },
      { providerId: id, timeoutMs: 8_000, retries: 0 },
    );
    const body = parseJson<{ success?: boolean }>(result, id);
    return {
      id,
      kind: 'llm',
      status: body.success === false ? 'rejected' : 'ok',
      detail: 'Account token accepted by Cloudflare.',
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
      rateLimitHeaders: result.rateLimitHeaders,
      deep: false,
    };
  },

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model ?? env().WORKERS_LLM_MODEL;
    const result = await providerRequest(
      runUrl(model),
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${request.userApiKey ?? token() ?? ''}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.prompt },
          ],
          max_tokens: request.maxOutputTokens,
          temperature: request.temperature ?? 0.7,
          stream: false,
        }),
      },
      { providerId: id, timeoutMs: 30_000, retries: 1, signal: request.signal },
    );

    const body = parseJson<WorkersChatResponse>(result, id);
    if (body.success === false) {
      throw new Error(`${id} reported an error: ${body.errors?.[0]?.message ?? 'unknown'}`);
    }
    const inner = body.result ?? {};
    return {
      providerId: id,
      model,
      text: (inner.choices?.[0]?.message?.content ?? '').trim(),
      inputTokens: inner.usage?.prompt_tokens ?? 0,
      outputTokens: inner.usage?.completion_tokens ?? 0,
      cached: false,
      finishReason: inner.choices?.[0]?.finish_reason ?? null,
      latencyMs: result.latencyMs,
      rateLimitHeaders: result.rateLimitHeaders,
    };
  },
};
