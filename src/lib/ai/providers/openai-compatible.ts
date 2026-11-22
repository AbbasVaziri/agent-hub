import { joinUrl, providerRequest, sseFrames } from "./http";
import {
  ProviderError,
  type ChatMessage,
  type ChatRequest,
  type ConnectionConfig,
  type ModelInfo,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderType,
  type StreamEvent,
} from "./types";

type OpenAiDelta = {
  content?: string | null;
  reasoning?: string | null;
  tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
};
type OpenAiChunk = {
  choices?: Array<{ delta?: OpenAiDelta; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string };
};

export function toOpenAiMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

export type OpenAiFlavor = {
  type: ProviderType;
  defaultBaseUrl: string | null;
  requiresApiKey: boolean;
  requiresBaseUrl: boolean;
  /** OpenAI's newer models reject max_tokens; compatible servers often only know max_tokens. */
  maxTokensField: "max_tokens" | "max_completion_tokens";
  extraHeaders?: Record<string, string>;
  capabilities(model: string): ProviderCapabilities;
  listModels?(conn: ConnectionConfig, signal?: AbortSignal): Promise<ModelInfo[]>;
};

export function createOpenAiStyleAdapter(flavor: OpenAiFlavor): ProviderAdapter {
  const base = (conn: ConnectionConfig) => {
    const b = conn.baseUrl || flavor.defaultBaseUrl;
    if (!b) throw new ProviderError("bad_request", "Base URL is required for this provider");
    return b;
  };
  const headers = (conn: ConnectionConfig): Record<string, string> => ({
    ...(conn.apiKey ? { authorization: `Bearer ${conn.apiKey}` } : {}),
    ...flavor.extraHeaders,
  });

  async function listModels(conn: ConnectionConfig, signal?: AbortSignal): Promise<ModelInfo[]> {
    if (flavor.listModels) return flavor.listModels(conn, signal);
    const res = await providerRequest(conn, joinUrl(base(conn), "models"), { headers: headers(conn), signal });
    const body = (await res.json()) as { data?: Array<{ id?: unknown; name?: unknown; context_length?: unknown }> };
    if (!Array.isArray(body.data)) throw new ProviderError("bad_request", "Provider did not return a model list");
    return body.data
      .filter((m): m is { id: string; name?: unknown; context_length?: unknown } => typeof m.id === "string")
      .map((m) => ({
        id: m.id,
        label: typeof m.name === "string" ? m.name : undefined,
        contextWindow: typeof m.context_length === "number" ? m.context_length : undefined,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  return {
    type: flavor.type,
    defaultBaseUrl: flavor.defaultBaseUrl,
    requiresApiKey: flavor.requiresApiKey,
    requiresBaseUrl: flavor.requiresBaseUrl,
    capabilities: flavor.capabilities,
    listModels,
    async testConnection(conn, signal) {
      const models = await listModels(conn, signal);
      return { ok: true, modelCount: models.length };
    },
    async *streamChat(conn: ConnectionConfig, req: ChatRequest): AsyncIterable<StreamEvent> {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: toOpenAiMessages(req.messages),
        stream: true,
        stream_options: { include_usage: true },
      };
      if (req.maxOutputTokens) body[flavor.maxTokensField] = req.maxOutputTokens;
      if (req.tools?.length) {
        body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
      }
      const res = await providerRequest(conn, joinUrl(base(conn), "chat/completions"), { headers: headers(conn), body, signal: req.signal });

      const pending = new Map<number, { id: string; name: string; arguments: string }>();
      let finish: StreamEvent & { type: "finish" } = { type: "finish", reason: "stop" };
      let sawUsage = false;

      for await (const frame of sseFrames(res, req.signal)) {
        if (frame.data === "[DONE]") break;
        let chunk: OpenAiChunk;
        try {
          chunk = JSON.parse(frame.data) as OpenAiChunk;
        } catch {
          continue;
        }
        if (chunk.error) throw new ProviderError("unavailable", chunk.error.message ?? "Provider stream error");
        const choice = chunk.choices?.[0];
        const delta = choice?.delta;
        if (delta?.content) yield { type: "text", text: delta.content };
        if (delta?.reasoning) yield { type: "reasoning", text: delta.reasoning };
        for (const tc of delta?.tool_calls ?? []) {
          const cur = pending.get(tc.index) ?? { id: "", name: "", arguments: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.arguments += tc.function.arguments;
          pending.set(tc.index, cur);
        }
        if (choice?.finish_reason) {
          const r = choice.finish_reason;
          finish = { type: "finish", reason: r === "stop" ? "stop" : r === "tool_calls" ? "tool_calls" : r === "length" ? "length" : "other" };
        }
        if (chunk.usage) {
          sawUsage = true;
          yield { type: "usage", inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 };
        }
      }
      for (const [, call] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
        if (!call.name) continue;
        yield { type: "tool_call", call: { id: call.id || `call_${crypto.randomUUID()}`, name: call.name, arguments: call.arguments || "{}" } };
      }
      if (pending.size > 0 && finish.reason === "stop") finish = { type: "finish", reason: "tool_calls" };
      if (!sawUsage) yield { type: "usage", inputTokens: 0, outputTokens: 0 };
      yield finish;
    },
  };
}

export const openAiCompatibleAdapter = createOpenAiStyleAdapter({
  type: "openai_compatible",
  defaultBaseUrl: null,
  requiresApiKey: false,
  requiresBaseUrl: true,
  maxTokensField: "max_tokens",
  capabilities: () => ({ streaming: true, toolCalling: true, vision: false, structuredOutput: false, reasoningSummary: false }),
});
