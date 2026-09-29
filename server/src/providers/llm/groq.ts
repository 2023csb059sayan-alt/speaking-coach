import { env } from '../../env';
import { createOpenAiCompatibleLlm } from './openAiCompatible';

/**
 * Groq chat models.
 *
 * Free tier (verified 2026-09-30, https://console.groq.com/docs/rate-limits):
 * 30 requests/minute, 1,000 requests/day, 8,000 tokens/minute, 200,000 tokens/day,
 * applied per organisation across all keys. Cached prompt tokens are not billed.
 */
export const groqLlm = createOpenAiCompatibleLlm({
  id: 'groq-llm',
  description: 'Fast open-weight chat model on Groq. The default brain for live conversation.',
  baseUrl: 'https://api.groq.com/openai/v1',
  defaultModel: env().GROQ_LLM_MODEL,
  apiKey: () => env().GROQ_API_KEY,
});
