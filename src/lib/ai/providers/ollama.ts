import { createOpenAiStyleAdapter } from "./openai-compatible";
import { joinUrl, providerRequest } from "./http";
import { ProviderError } from "./types";

/**
 * Ollama serves an OpenAI-compatible API under /v1; the native /api/tags is used
 * for model listing because it works on every version.
 */
export const ollamaAdapter = createOpenAiStyleAdapter({
  type: "ollama",
  defaultBaseUrl: "http://127.0.0.1:11434/v1",
  requiresApiKey: false,
  requiresBaseUrl: true,
  maxTokensField: "max_tokens",
  capabilities: () => ({ streaming: true, toolCalling: true, vision: false, structuredOutput: false, reasoningSummary: false }),
  async listModels(conn, signal) {
    const root = (conn.baseUrl || "http://127.0.0.1:11434/v1").replace(/\/v1\/?$/, "");
    const res = await providerRequest(conn, joinUrl(root, "api/tags"), { signal });
    const body = (await res.json()) as { models?: Array<{ name?: unknown; model?: unknown }> };
    if (!Array.isArray(body.models)) throw new ProviderError("bad_request", "Ollama did not return a model list");
    return body.models
      .map((m) => (typeof m.model === "string" ? m.model : typeof m.name === "string" ? m.name : null))
      .filter((id): id is string => !!id)
      .map((id) => ({ id }));
  },
});
