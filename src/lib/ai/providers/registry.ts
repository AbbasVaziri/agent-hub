import { anthropicAdapter } from "./anthropic";
import { ollamaAdapter } from "./ollama";
import { openAiAdapter } from "./openai";
import { openAiCompatibleAdapter } from "./openai-compatible";
import { openRouterAdapter } from "./openrouter";
import type { ProviderAdapter, ProviderType } from "./types";

const ADAPTERS: Record<ProviderType, ProviderAdapter> = {
  openai: openAiAdapter,
  anthropic: anthropicAdapter,
  openrouter: openRouterAdapter,
  ollama: ollamaAdapter,
  openai_compatible: openAiCompatibleAdapter,
};

export function getAdapter(type: ProviderType): ProviderAdapter {
  return ADAPTERS[type];
}

export const PROVIDER_TYPES = Object.keys(ADAPTERS) as ProviderType[];
