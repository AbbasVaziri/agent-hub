import { createOpenAiStyleAdapter } from "./openai-compatible";
import { env } from "@/lib/env";

export const openRouterAdapter = createOpenAiStyleAdapter({
  type: "openrouter",
  defaultBaseUrl: "https://openrouter.ai/api/v1",
  requiresApiKey: true,
  requiresBaseUrl: false,
  maxTokensField: "max_tokens",
  get extraHeaders() {
    // OpenRouter uses these for attribution only.
    return { "HTTP-Referer": env().APP_URL, "X-Title": "Agent Hub" };
  },
  capabilities: () => ({ streaming: true, toolCalling: true, vision: false, structuredOutput: false, reasoningSummary: false }),
});
