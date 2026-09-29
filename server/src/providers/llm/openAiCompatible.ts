import type { ProviderCapabilities } from '@speaking-coach/shared';
import { freeQuotaFor } from '../../config/freeTiers';
import {
  parseJson,
  providerRequest,
  type ProviderResponse,
} from '../http';
import type { LLMProvider, LLMRequest, LLMResponse, ProviderHealth } from '../types';

/**
 * Adapter for providers that speak the OpenAI chat-completions shape.
 *
 * Groq, OpenRouter and several free gateways do, so one adapter covers them. The
 * differences that matter (base URL, auth header, default model, health endpoint)
 * are passed in, and the capability descriptor is built from the verified free
 * tier table rather than hard-coded per adapter.
 */

interface OpenAiCompatibleConfig {
  id: string;
  description: string;
  baseUrl: string;
  defaultModel: string;
  /** Resolved per call so a learner's bring-your-own-key can override the shared one. */
  apiKey: () => string | undefined;
  modelsPath?: string;
  /** Some gateways need an extra header to identify the app. */
  extraHeaders?: () => Record<string, string>;
  /** True when the provider can stream; none of the free tiers we use need it. */
  streaming?: boolean;
  wordTimestamps?: boolean;
}

interface ChatCompletionBody {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

interface ModelListBody {
  data?: Array<{ id?: string }> | Record<string, unknown>;
}

export function createOpenAiCompatibleLlm(config: OpenAiCompatibleConfig): LLMProvider {
  const capabilities: ProviderCapabilities = {
    id: config.id,
    kind: 'llm',
    wordTimestamps: config.wordTimestamps ?? false,
    streaming: config.streaming ?? false,
    pronunciationScoring: false,
    onDevice: false,
    freeQuota: freeQuotaFor(config.id),
    description: config.description,
  };

  const modelsPath = config.modelsPath ?? '/models';

  const authHeader = (userApiKey?: string): Record<string, string> => {
    const key = userApiKey ?? config.apiKey();
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (key) headers['authorization'] = `Bearer ${key}`;
    return { ...headers, ...(config.extraHeaders?.() ?? {}) };
  };

  const provider: LLMProvider = {
    id: config.id,
    kind: 'llm',
    capabilities,

    isConfigured(): boolean {
      return Boolean(config.apiKey()) && config.defaultModel.length > 0;
    },

    configurationHint(): string | null {
      if (!config.apiKey()) return `Set the API key for ${config.id} in the server environment.`;
      if (!config.defaultModel) {
        return `Set the model id for ${config.id}. Model names change, so we never guess one.`;
      }
      return null;
    },

    async healthCheck(options: { deep: boolean }): Promise<ProviderHealth> {
      const key = config.apiKey();
      if (!key || !config.defaultModel) {
        return {
          id: config.id,
          kind: 'llm',
          status: 'unconfigured',
          detail: provider.configurationHint() ?? 'Not configured.',
          latencyMs: null,
          checkedAt: new Date().toISOString(),
          rateLimitHeaders: null,
          deep: false,
        };
      }
      if (options.deep) {
        // A real, minimal inference. Costs one request of the daily quota, so it
        // runs on a timer rather than on every page load.
        try {
          const response = await provider.complete({
            system: 'You reply with one word.',
            prompt: 'Reply with the word: ready',
            maxOutputTokens: 4,
            purpose: 'probe',
          });
          return {
            id: config.id,
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
            id: config.id,
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
      const result: ProviderResponse = await providerRequest(
        `${config.baseUrl}${modelsPath}`,
        { method: 'GET', headers: authHeader() },
        { providerId: config.id, timeoutMs: 8_000, retries: 0 },
      );
      const body = parseJson<ModelListBody>(result, config.id);
      const listed = Array.isArray(body.data)
        ? `${body.data.length} models listed`
        : 'account endpoint responded';
      return {
        id: config.id,
        kind: 'llm',
        status: 'ok',
        detail: `Key accepted: ${listed}.`,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
        rateLimitHeaders: result.rateLimitHeaders,
        deep: false,
      };
    },

    async complete(request: LLMRequest): Promise<LLMResponse> {
      const model = request.model ?? config.defaultModel;
      const result = await providerRequest(
        `${config.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: authHeader(request.userApiKey),
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.prompt },
            ],
            max_tokens: request.maxOutputTokens,
            temperature: request.temperature ?? 0.7,
            stream: false,
          }),
        },
        { providerId: config.id, timeoutMs: 25_000, retries: 1, signal: request.signal },
      );

      const body = parseJson<ChatCompletionBody>(result, config.id);
      const text = body.choices?.[0]?.message?.content ?? '';
      return {
        providerId: config.id,
        model,
        text: text.trim(),
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
        cached: (body.usage?.prompt_tokens_details?.cached_tokens ?? 0) > 0,
        finishReason: body.choices?.[0]?.finish_reason ?? null,
        latencyMs: result.latencyMs,
        rateLimitHeaders: result.rateLimitHeaders,
      };
    },
  };

  return provider;
}
