import { joinUrl, providerRequest, sseFrames } from "./http";
import { ProviderError, type ChatMessage, type ConnectionConfig, type ProviderAdapter, type StreamEvent } from "./types";

const VERSION = "2023-06-01";

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

/** Anthropic wants system separately and tool results as user turns; adjacent same-role turns are merged. */
export function toAnthropicMessages(messages: ChatMessage[]) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const out: Array<{ role: "user" | "assistant"; content: Block[] }> = [];
  const push = (role: "user" | "assistant", blocks: Block[]) => {
    if (blocks.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user") push("user", [{ type: "text", text: m.content }]);
    else if (m.role === "tool") push("user", [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }]);
    else {
      const blocks: Block[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const c of m.toolCalls ?? []) {
        let input: unknown = {};
        try {
          input = JSON.parse(c.arguments || "{}");
        } catch {
          input = {};
        }
        blocks.push({ type: "tool_use", id: c.id, name: c.name, input });
      }
      push("assistant", blocks);
    }
  }
  return { system, messages: out };
}

const base = (conn: ConnectionConfig) => conn.baseUrl || "https://api.anthropic.com/v1";
const headers = (conn: ConnectionConfig) => ({ "x-api-key": conn.apiKey ?? "", "anthropic-version": VERSION });

type AnthropicEvent = {
  type: string;
  index?: number;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string; thinking?: string; stop_reason?: string };
  usage?: { output_tokens?: number };
  error?: { message?: string };
};

export const anthropicAdapter: ProviderAdapter = {
  type: "anthropic",
  defaultBaseUrl: "https://api.anthropic.com/v1",
  requiresApiKey: true,
  requiresBaseUrl: false,
  capabilities: () => ({ streaming: true, toolCalling: true, vision: false, structuredOutput: false, reasoningSummary: false }),
  async listModels(conn, signal) {
    const res = await providerRequest(conn, joinUrl(base(conn), "models?limit=100"), { headers: headers(conn), signal });
    const body = (await res.json()) as { data?: Array<{ id?: unknown; display_name?: unknown }> };
    if (!Array.isArray(body.data)) throw new ProviderError("bad_request", "Anthropic did not return a model list");
    return body.data
      .filter((m): m is { id: string; display_name?: unknown } => typeof m.id === "string")
      .map((m) => ({ id: m.id, label: typeof m.display_name === "string" ? m.display_name : undefined }));
  },
  async testConnection(conn, signal) {
    const models = await this.listModels(conn, signal);
    return { ok: true, modelCount: models.length };
  },
  async *streamChat(conn, req): AsyncIterable<StreamEvent> {
    const { system, messages } = toAnthropicMessages(req.messages);
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxOutputTokens ?? 4096,
      messages,
      stream: true,
    };
    if (system) body.system = system;
    if (req.tools?.length) body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));

    const res = await providerRequest(conn, joinUrl(base(conn), "messages"), { headers: headers(conn), body, signal: req.signal });
    const blocks = new Map<number, { kind: "text" | "tool"; id?: string; name?: string; json: string }>();
    let input = 0;
    let output = 0;
    let stop: string | undefined;

    for await (const frame of sseFrames(res, req.signal)) {
      let ev: AnthropicEvent;
      try {
        ev = JSON.parse(frame.data) as AnthropicEvent;
      } catch {
        continue;
      }
      switch (ev.type) {
        case "message_start":
          input = ev.message?.usage?.input_tokens ?? 0;
          output = ev.message?.usage?.output_tokens ?? 0;
          break;
        case "content_block_start":
          if (ev.content_block?.type === "tool_use") blocks.set(ev.index ?? 0, { kind: "tool", id: ev.content_block.id, name: ev.content_block.name, json: "" });
          else blocks.set(ev.index ?? 0, { kind: "text", json: "" });
          break;
        case "content_block_delta":
          if (ev.delta?.type === "text_delta" && ev.delta.text) yield { type: "text", text: ev.delta.text };
          else if (ev.delta?.type === "input_json_delta") {
            const b = blocks.get(ev.index ?? 0);
            if (b) b.json += ev.delta.partial_json ?? "";
          }
          break;
        case "content_block_stop": {
          const b = blocks.get(ev.index ?? 0);
          if (b?.kind === "tool" && b.name) yield { type: "tool_call", call: { id: b.id ?? `toolu_${crypto.randomUUID()}`, name: b.name, arguments: b.json || "{}" } };
          break;
        }
        case "message_delta":
          if (ev.usage?.output_tokens !== undefined) output = ev.usage.output_tokens;
          if (ev.delta?.stop_reason) stop = ev.delta.stop_reason;
          break;
        case "error":
          throw new ProviderError("unavailable", ev.error?.message ?? "Anthropic stream error");
      }
    }
    yield { type: "usage", inputTokens: input, outputTokens: output };
    yield {
      type: "finish",
      reason: stop === "tool_use" ? "tool_calls" : stop === "max_tokens" ? "length" : stop === "end_turn" || stop === "stop_sequence" ? "stop" : "other",
    };
  },
};
