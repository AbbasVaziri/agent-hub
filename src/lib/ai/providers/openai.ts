import { createOpenAiStyleAdapter } from "./openai-compatible";

export const openAiAdapter = createOpenAiStyleAdapter({
  type: "openai",
  defaultBaseUrl: "https://api.openai.com/v1",
  requiresApiKey: true,
  requiresBaseUrl: false,
  maxTokensField: "max_completion_tokens",
  capabilities: () => ({ streaming: true, toolCalling: true, vision: false, structuredOutput: true, reasoningSummary: false }),
});
