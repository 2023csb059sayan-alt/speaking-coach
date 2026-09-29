/** Provider ids known to the API. Used for config validation and for the registry. */
export const PROVIDER_IDS = [
  'groq-llm',
  'groq-stt',
  'groq-tts',
  'workersai-llm',
  'workersai-stt',
  'gemini-llm',
  'gemini-tts',
  'openrouter-llm',
  'azure-stt',
  'azure-tts',
  'ollama-llm',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}
