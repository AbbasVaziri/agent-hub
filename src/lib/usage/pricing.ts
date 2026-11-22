import type { ProviderType } from "../ai/providers/types";

export type Pricing = { inputPerMTok: number; outputPerMTok: number };

/**
 * Fallback rates when a connection has no pricing set. They are deliberately
 * high so budgets trip early rather than late. Local Ollama models cost nothing.
 */
export function fallbackPricing(type: ProviderType): Pricing {
  if (type === "ollama") return { inputPerMTok: 0, outputPerMTok: 0 };
  return {
    inputPerMTok: Number(process.env.PRICE_FALLBACK_INPUT_PER_MTOK ?? 5),
    outputPerMTok: Number(process.env.PRICE_FALLBACK_OUTPUT_PER_MTOK ?? 25),
  };
}

export function estimateCost(p: Pricing, inputTokens: number, outputTokens: number): number {
  return (inputTokens * p.inputPerMTok + outputTokens * p.outputPerMTok) / 1_000_000;
}
