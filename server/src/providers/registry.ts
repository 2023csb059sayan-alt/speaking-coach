import type { ProviderKind } from '@speaking-coach/shared';
import { env } from '../env';
import { PROVIDER_KIND_BY_ID } from '../config/freeTiers';
import { geminiLlm } from './llm/gemini';
import { groqLlm } from './llm/groq';
import { ollamaLlm } from './llm/ollama';
import { openRouterLlm } from './llm/openrouter';
import { workersAiLlm } from './llm/workersAi';
import { groqStt } from './stt/groqWhisper';
import { workersAiStt } from './stt/workersAiWhisper';
import { groqTts } from './tts/groqOrpheus';
import type { BaseProvider, LLMProvider, SpeechToTextProvider, TextToSpeechProvider } from './types';

/**
 * Provider registry.
 *
 * Order inside each list is the preference order inside the matching chain. The
 * chain itself comes from the environment, so an operator can reorder or extend it
 * without a code change, and the UI can always show what is available.
 */

export const LLM_PROVIDERS: LLMProvider[] = [groqLlm, workersAiLlm, geminiLlm, openRouterLlm, ollamaLlm];

export const STT_PROVIDERS: SpeechToTextProvider[] = [groqStt, workersAiStt];

export const TTS_PROVIDERS: TextToSpeechProvider[] = [groqTts];

export function allProviders(): BaseProvider[] {
  return [...LLM_PROVIDERS, ...STT_PROVIDERS, ...TTS_PROVIDERS];
}

export function providerById(id: string): BaseProvider | null {
  return allProviders().find((provider) => provider.id === id) ?? null;
}

export function llmById(id: string): LLMProvider | null {
  return LLM_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

export function sttById(id: string): SpeechToTextProvider | null {
  return STT_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

export function ttsById(id: string): TextToSpeechProvider | null {
  return TTS_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

export function configuredChainIds(kind: ProviderKind): string[] {
  const config = env();
  switch (kind) {
    case 'llm':
      return [...config.CHAIN_LLM];
    case 'stt':
      return [...config.CHAIN_STT];
    case 'tts':
      return [...config.CHAIN_TTS];
    case 'pronunciation':
      return [];
  }
}

export function orderedProviders(kind: ProviderKind): BaseProvider[] {
  const chain = configuredChainIds(kind);
  const all = allProviders().filter((provider) => provider.kind === kind);
  return chain
    .map((id) => all.find((provider) => provider.id === id))
    .filter((provider): provider is BaseProvider => Boolean(provider));
}

/** Chain entries that are configured and therefore worth offering right now. */
export function readyProviders(kind: ProviderKind): BaseProvider[] {
  return orderedProviders(kind).filter((provider) => provider.isConfigured());
}

/** Capability flags for the whole product, used by the client to build its UI. */
export function capabilitySnapshot(): Record<string, boolean> {
  const providers = allProviders();
  return {
    wordTimestamps: providers.some((provider) => provider.capabilities.wordTimestamps),
    streaming: providers.some((provider) => provider.capabilities.streaming),
    pronunciationScoring: providers.some((provider) => provider.capabilities.pronunciationScoring),
  };
}

export function kindOfProviderId(id: string): ProviderKind | null {
  return PROVIDER_KIND_BY_ID[id] ?? null;
}
