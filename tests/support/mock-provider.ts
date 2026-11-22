/**
 * Deterministic OpenAI-compatible server for tests and local demos.
 * Behaviour is driven by markers in the latest user message:
 *   [calc:2+3]  -> calls the calculate tool, then reports the result
 *   [time]      -> calls get_current_datetime
 *   [delegate]  -> delegates the rest of the message to the first listed subagent
 *   [handoff]   -> hands off to the first listed handoff target
 *   [slow]      -> streams slowly (for stop/cancel tests)
 *   [fail]      -> responds with HTTP 500
 *   anything else -> echoes the message back word by word
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

type Msg = { role: string; content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };

export const MOCK_API_KEY = "mock-test-key";

function sse(res: http.ServerResponse, obj: unknown) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function streamText(res: http.ServerResponse, text: string, delayMs: number, closed: () => boolean) {
  const words = text.split(/(\s+)/);
  for (const w of words) {
    if (closed()) return;
    sse(res, { choices: [{ delta: { content: w }, finish_reason: null }] });
    if (delayMs) await sleep(delayMs);
  }
}

function toolCall(res: http.ServerResponse, name: string, args: unknown) {
  sse(res, {
    choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${Math.random().toString(36).slice(2, 10)}`, function: { name, arguments: "" } }] }, finish_reason: null }],
  });
  const json = JSON.stringify(args);
  // Split the arguments to exercise incremental tool-call parsing.
  const mid = Math.floor(json.length / 2);
  sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: json.slice(0, mid) } }] }, finish_reason: null }] });
  sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: json.slice(mid) } }] }, finish_reason: "tool_calls" }] });
}

function firstListedId(system: string, header: string): string | null {
  const idx = system.indexOf(header);
  if (idx < 0) return null;
  const m = /id: ([\w-]+)/.exec(system.slice(idx));
  return m ? m[1] : null;
}

async function handleChat(body: { messages: Msg[]; tools?: unknown[] }, res: http.ServerResponse, closed: () => boolean) {
  const system = body.messages.find((m) => m.role === "system")?.content ?? "";
  const last = body.messages[body.messages.length - 1];
  const lastUser = [...body.messages].reverse().find((m) => m.role === "user")?.content ?? "";

  if (lastUser.includes("[fail]")) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "mock upstream failure" } }));
    return;
  }

  res.writeHead(200, { "content-type": "text/event-stream" });
  const finish = (reason = "stop") => {
    sse(res, { choices: [{ delta: {}, finish_reason: reason }] });
    sse(res, { choices: [], usage: { prompt_tokens: 50, completion_tokens: 20 } });
    res.write("data: [DONE]\n\n");
    res.end();
  };

  if (last.role === "tool") {
    await streamText(res, `Tool result: ${last.content}`, 5, closed);
    return finish();
  }
  if (system.includes("running as a subagent")) {
    await streamText(res, `Subagent answer for: ${lastUser}`, 2, closed);
    return finish();
  }
  if (system.includes("HANDOFF:")) {
    await streamText(res, "I have taken over this conversation.", 5, closed);
    return finish();
  }

  const calc = /\[calc:([^\]]+)\]/.exec(lastUser);
  if (calc) {
    toolCall(res, "calculate", { expression: calc[1] });
    return finish("tool_calls");
  }
  if (lastUser.includes("[time]")) {
    toolCall(res, "get_current_datetime", { timeZone: "Asia/Tehran" });
    return finish("tool_calls");
  }
  if (lastUser.includes("[delegate]")) {
    const id = firstListedId(system, "SUBAGENTS");
    if (id) {
      toolCall(res, "delegate_to_agent", { subagentId: id, taskPrompt: lastUser.replace("[delegate]", "").trim() || "task" });
      return finish("tool_calls");
    }
  }
  if (lastUser.includes("[handoff]")) {
    const id = firstListedId(system, "AGENTS you may hand");
    if (id) {
      toolCall(res, "handoff_to_agent", { targetAgentId: id, summaryOfConversation: "User asked for a specialist." });
      return finish("tool_calls");
    }
  }
  const slow = lastUser.includes("[slow]");
  const text = slow ? Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ") : `Echo: ${lastUser}`;
  await streamText(res, text, slow ? 120 : 8, closed);
  return finish();
}

export function createMockProvider() {
  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${MOCK_API_KEY}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid API key" } }));
      return;
    }
    if (req.method === "GET" && req.url?.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "mock-small" }, { id: "mock-large" }] }));
      return;
    }
    if (req.method === "POST" && req.url?.endsWith("/chat/completions")) {
      let raw = "";
      let closed = false;
      res.on("close", () => (closed = true));
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        void handleChat(JSON.parse(raw), res, () => closed).catch(() => res.end());
      });
      return;
    }
    res.writeHead(404).end();
  });
  return {
    server,
    async listen(port = 0): Promise<string> {
      await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
