import { env } from '../../env';
import { createOpenAiCompatibleLlm } from './openAiCompatible';

/**
 * OpenRouter free models.
 *
 * Free tier (verified 2026-09-30, https://openrouter.ai/docs/api/reference/limits):
 * 20 requests/minute and 50 requests/day for `:free` models while lifetime credits
 * stay under $10, rising to 1,000/day afterwards. The exact remaining count is read
 * from GET /api/v1/key -> free_model_daily_requests, which the shallow health check
 * uses so the budget panel can show the provider's real number.
 */
export const openRouterLlm = createOpenAiCompatibleLlm({
  id: 'openrouter-llm',
  description: 'A wide choice of free community models. Useful as an extra fallback.',
  baseUrl: 'https://openrouter.ai/api/v1',
  // There is deliberately no default model: free model ids change often, so the
  // operator has to name the one they have checked.
  defaultModel: env().OPENROUTER_LLM_MODEL ?? '',
  apiKey: () => env().OPENROUTER_API_KEY,
  modelsPath: '/key',
  extraHeaders: () => ({ 'x-title': 'Speaking Coach', 'http-referer': env().API_BASE_URL }),
});
