import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockProvider, MOCK_API_KEY } from "../support/mock-provider";
import { openAiCompatibleAdapter, toOpenAiMessages } from "@/lib/ai/providers/openai-compatible";
import { toAnthropicMessages } from "@/lib/ai/providers/anthropic";
import { ProviderError, type ConnectionConfig, type StreamEvent } from "@/lib/ai/providers/types";
import { getAdapter } from "@/lib/ai/providers/registry";

const mock = createMockProvider();
let conn: ConnectionConfig;

beforeAll(async () => {
  const baseUrl = await mock.listen();
  conn = { providerType: "openai_compatible", baseUrl, apiKey: MOCK_API_KEY, policy: { allowPrivate: true } };
});
afterAll(() => mock.close());

async function collect(it: AsyncIterable<StreamEvent>) {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe("OpenAI-compatible adapter against the mock provider", () => {
  it("lists models and tests the connection", async () => {
    expect((await openAiCompatibleAdapter.listModels(conn)).map((m) => m.id)).toEqual(["mock-large", "mock-small"]);
    expect(await openAiCompatibleAdapter.testConnection(conn)).toEqual({ ok: true, modelCount: 2 });
  });

  it("normalises a bad key into an auth error", async () => {
    await expect(openAiCompatibleAdapter.listModels({ ...conn, apiKey: "wrong" })).rejects.toMatchObject({ kind: "auth" });
  });

  it("streams text and usage", async () => {
    const events = await collect(
      openAiCompatibleAdapter.streamChat(conn, { model: "mock-small", messages: [{ role: "user", content: "سلام world" }], signal: new AbortController().signal }),
    );
    const text = events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("");
    expect(text).toBe("Echo: سلام world");
    expect(events).toContainEqual({ type: "usage", inputTokens: 50, outputTokens: 20 });
    expect(events.at(-1)).toEqual({ type: "finish", reason: "stop" });
  });

  it("assembles tool calls from incremental deltas", async () => {
    const events = await collect(
      openAiCompatibleAdapter.streamChat(conn, {
        model: "mock-small",
        messages: [{ role: "user", content: "[calc:6*7]" }],
        tools: [{ name: "calculate", description: "", parameters: { type: "object" } }],
        signal: new AbortController().signal,
      }),
    );
    const call = events.find((e) => e.type === "tool_call") as { call: { name: string; arguments: string } };
    expect(call.call.name).toBe("calculate");
    expect(JSON.parse(call.call.arguments)).toEqual({ expression: "6*7" });
    expect(events.at(-1)).toEqual({ type: "finish", reason: "tool_calls" });
  });

  it("maps upstream 5xx to an unavailable ProviderError", async () => {
    await expect(
      collect(openAiCompatibleAdapter.streamChat(conn, { model: "m", messages: [{ role: "user", content: "[fail]" }], signal: new AbortController().signal })),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it("cancels mid-stream", async () => {
    const ctrl = new AbortController();
    const it = openAiCompatibleAdapter.streamChat(conn, { model: "m", messages: [{ role: "user", content: "[slow]" }], signal: ctrl.signal });
    let n = 0;
    await expect(
      (async () => {
        for await (const e of it) {
          if (e.type === "text" && ++n === 3) ctrl.abort();
        }
      })(),
    ).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("refuses private base URLs when not in trusted mode", async () => {
    await expect(openAiCompatibleAdapter.listModels({ ...conn, policy: { allowPrivate: false } })).rejects.toThrow(/blocked/i);
  });
});

describe("message mapping", () => {
  const history = [
    { role: "system" as const, content: "S" },
    { role: "user" as const, content: "hi" },
    { role: "assistant" as const, content: "", toolCalls: [{ id: "t1", name: "calculate", arguments: '{"expression":"1+1"}' }] },
    { role: "tool" as const, toolCallId: "t1", name: "calculate", content: '{"result":2}' },
  ];
  it("maps to OpenAI tool_calls format", () => {
    const m = toOpenAiMessages(history);
    expect(m[2]).toMatchObject({ role: "assistant", tool_calls: [{ id: "t1", type: "function" }] });
    expect(m[3]).toEqual({ role: "tool", tool_call_id: "t1", content: '{"result":2}' });
  });
  it("maps to Anthropic blocks with system split out and tool results as user turns", () => {
    const { system, messages } = toAnthropicMessages(history);
    expect(system).toBe("S");
    expect(messages[1]).toEqual({ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "calculate", input: { expression: "1+1" } }] });
    expect(messages[2]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: '{"result":2}' }] });
  });
  it("does not advertise vision or reasoning summaries", () => {
    for (const t of ["openai", "anthropic", "openrouter", "ollama", "openai_compatible"] as const) {
      const c = getAdapter(t).capabilities("any");
      expect(c.vision).toBe(false);
      expect(c.reasoningSummary).toBe(false);
    }
  });
});
