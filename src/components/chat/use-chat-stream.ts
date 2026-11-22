"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SseParser } from "@/lib/sse/parser";
import type { RunEventData, RunEventType } from "@/lib/ai/events";
import { api } from "@/lib/client/api";

export type LiveItem =
  | { kind: "message"; id: string; role: "user" | "assistant"; content: string; status: "streaming" | "completed" | "failed" | "cancelled" | "pending"; agentId: string | null; errorMessage?: string }
  | { kind: "tool"; id: string; name: string; status: "started" | "waiting_for_approval" | "completed" | "failed" | "rejected"; agentId: string | null }
  | { kind: "delegation"; id: string; agentId: string; status: "running" | "completed" | "failed" | "cancelled" }
  | { kind: "handoff"; id: string; fromAgentId: string | null; toAgentId: string; summary: string }
  | { kind: "approval"; id: string; toolName: string; agentId: string | null; status: "pending" | "approved" | "rejected" | "expired"; expiresAt: string }
  | { kind: "reasoning"; id: string; text: string };

export type StreamState = {
  runId: string | null;
  items: LiveItem[];
  status: "idle" | "streaming" | "stopping" | "reconnecting";
  error: { code: string; message: string } | null;
};

const initial: StreamState = { runId: null, items: [], status: "idle", error: null };
const MAX_RECONNECTS = 6;

/**
 * Drives one conversation's live run. POST bodies need fetch, not EventSource,
 * so frames are parsed from the response stream by hand.
 */
export function useChatStream(conversationId: string | null, opts: { onSettled?: () => void } = {}) {
  const [state, setState] = useState<StreamState>(initial);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const runRef = useRef<string | null>(null);
  // Bumped whenever the conversation changes; late events from an old stream are dropped.
  const generation = useRef(0);
  const onSettled = useRef(opts.onSettled);
  onSettled.current = opts.onSettled;

  useEffect(() => {
    generation.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    seqRef.current = 0;
    runRef.current = null;
    // Resetting on a new conversation id is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(initial);
    return () => abortRef.current?.abort();
  }, [conversationId]);

  const apply = useCallback(<T extends RunEventType>(type: T, data: RunEventData<T>) => {
    setState((s) => {
      const items = [...s.items];
      const upsert = (item: LiveItem) => {
        const i = items.findIndex((x) => x.kind === item.kind && x.id === item.id);
        if (i >= 0) items[i] = { ...items[i], ...item } as LiveItem;
        else items.push(item);
      };
      switch (type) {
        case "run": {
          const d = data as RunEventData<"run">;
          runRef.current = d.runId;
          const pi = items.findIndex((x) => x.kind === "message" && x.role === "user" && x.status === "pending");
          if (pi >= 0) {
            const pu = items[pi] as Extract<LiveItem, { kind: "message" }>;
            items[pi] = { ...pu, id: d.userMessageId || pu.id, status: "completed" };
          }
          upsert({ kind: "message", id: d.messageId, role: "assistant", content: "", status: "streaming", agentId: d.agentId });
          return { ...s, items, runId: d.runId, status: s.status === "stopping" ? "stopping" : "streaming", error: null };
        }
        case "chunk": {
          const d = data as RunEventData<"chunk">;
          const i = items.findIndex((x) => x.kind === "message" && x.id === d.messageId);
          if (i >= 0) {
            const m = items[i] as Extract<LiveItem, { kind: "message" }>;
            items[i] = { ...m, content: m.content + d.text };
          }
          return { ...s, items, status: s.status === "reconnecting" ? "streaming" : s.status };
        }
        case "reasoning": {
          const d = data as RunEventData<"reasoning">;
          const last = items[items.length - 1];
          if (last?.kind === "reasoning") items[items.length - 1] = { ...last, text: last.text + d.text };
          else items.push({ kind: "reasoning", id: `r${items.length}`, text: d.text });
          return { ...s, items };
        }
        case "tool_call": {
          const d = data as RunEventData<"tool_call">;
          upsert({ kind: "tool", id: d.toolCallId, name: d.name, status: d.status, agentId: d.agentId });
          return { ...s, items };
        }
        case "tool_result": {
          const d = data as RunEventData<"tool_result">;
          const i = items.findIndex((x) => x.kind === "tool" && x.id === d.toolCallId);
          if (i >= 0) items[i] = { ...(items[i] as Extract<LiveItem, { kind: "tool" }>), status: d.status };
          return { ...s, items };
        }
        case "delegation": {
          const d = data as RunEventData<"delegation">;
          upsert({ kind: "delegation", id: d.delegationId, agentId: d.agentId, status: d.status });
          return { ...s, items };
        }
        case "handoff": {
          const d = data as RunEventData<"handoff">;
          items.forEach((x, i) => {
            if (x.kind === "message" && x.status === "streaming") items[i] = { ...x, status: "completed" };
          });
          items.push({ kind: "handoff", id: `h-${d.messageId}`, fromAgentId: d.fromAgentId, toAgentId: d.toAgentId, summary: d.summary });
          items.push({ kind: "message", id: d.messageId, role: "assistant", content: "", status: "streaming", agentId: d.toAgentId });
          return { ...s, items };
        }
        case "approval_required": {
          const d = data as RunEventData<"approval_required">;
          upsert({ kind: "approval", id: d.approvalId, toolName: d.toolName, agentId: d.agentId, status: "pending", expiresAt: d.expiresAt });
          return { ...s, items };
        }
        case "approval_resolved": {
          const d = data as RunEventData<"approval_resolved">;
          const i = items.findIndex((x) => x.kind === "approval" && x.id === d.approvalId);
          if (i >= 0) items[i] = { ...(items[i] as Extract<LiveItem, { kind: "approval" }>), status: d.status };
          return { ...s, items };
        }
        case "error": {
          const d = data as RunEventData<"error">;
          if (d.messageId) {
            const i = items.findIndex((x) => x.kind === "message" && x.id === d.messageId);
            if (i >= 0) items[i] = { ...(items[i] as Extract<LiveItem, { kind: "message" }>), status: "failed", errorMessage: d.message };
          }
          return { ...s, items, error: { code: d.code, message: d.message } };
        }
        case "done": {
          const d = data as RunEventData<"done">;
          items.forEach((x, i) => {
            if (x.kind === "message" && x.status === "streaming") items[i] = { ...x, status: d.status === "completed" ? "completed" : d.status };
          });
          return { ...s, items, status: "idle" };
        }
      }
      return s;
    });
  }, []);

  /** Reads one SSE response to the end. Returns true when the run reached `done`. */
  const consume = useCallback(
    async (res: Response, gen: number): Promise<boolean> => {
      if (!res.body) return false;
      const reader = res.body.getReader();
      const parser = new SseParser();
      let finished = false;
      const handle = (frames: ReturnType<SseParser["push"]>) => {
        for (const f of frames) {
          if (gen !== generation.current) return;
          const seq = f.id ? Number(f.id) : 0;
          if (seq && seq <= seqRef.current) continue;
          if (seq) seqRef.current = seq;
          let data: unknown;
          try {
            data = JSON.parse(f.data);
          } catch {
            continue;
          }
          apply(f.event as RunEventType, data as never);
          if (f.event === "done") finished = true;
        }
      };
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          handle(parser.push(value));
        }
        handle(parser.end());
      } catch {
        /* network drop or local abort; caller decides */
      }
      return finished;
    },
    [apply],
  );

  const follow = useCallback(
    async (initialRes: Response | null, runIdHint: string | null, gen: number, ctrl: AbortController) => {
      let res = initialRes;
      for (let attempt = 0; ; attempt++) {
        const finished = res ? await consume(res, gen) : false;
        if (finished || ctrl.signal.aborted || gen !== generation.current) break;
        const runId = runRef.current ?? runIdHint;
        if (!runId || attempt >= MAX_RECONNECTS) {
          setState((s) => ({ ...s, status: "idle", error: s.error ?? { code: "NETWORK", message: "" } }));
          break;
        }
        // The run keeps going on the server; pick the log up where we left it.
        setState((s) => ({ ...s, status: s.status === "stopping" ? "stopping" : "reconnecting" }));
        await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** attempt, 8000)));
        if (ctrl.signal.aborted || gen !== generation.current) break;
        try {
          res = await fetch(`/api/runs/${runId}/events?after=${seqRef.current}`, { signal: ctrl.signal });
          if (!res.ok) res = null;
        } catch {
          res = null;
        }
      }
      if (gen === generation.current) onSettled.current?.();
    },
    [consume],
  );

  const start = useCallback(
    async (input: { conversationId: string; content: string; retryOfMessageId?: string; optimisticUser?: boolean }) => {
      const gen = generation.current;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      seqRef.current = 0;
      runRef.current = null;
      const clientMessageId = crypto.randomUUID();
      setState({
        runId: null,
        status: "streaming",
        error: null,
        items: input.optimisticUser === false ? [] : [{ kind: "message", id: `local-${clientMessageId}`, role: "user", content: input.content, status: "pending", agentId: null }],
      });
      let res: Response;
      try {
        res = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId: input.conversationId, content: input.content, clientMessageId, retryOfMessageId: input.retryOfMessageId }),
          signal: ctrl.signal,
        });
      } catch {
        if (gen === generation.current) setState((s) => ({ ...s, status: "idle", error: { code: "NETWORK", message: "" } }));
        return;
      }
      if (!res.ok) {
        let err = { code: "HTTP_ERROR", message: res.statusText };
        try {
          err = ((await res.json()) as { error: typeof err }).error;
        } catch {
          /* ignore */
        }
        if (gen === generation.current) {
          setState((s) => ({ ...s, status: "idle", error: err, items: s.items.map((x) => (x.kind === "message" && x.status === "pending" ? { ...x, status: "failed" } : x)) }));
        }
        return;
      }
      await follow(res, null, gen, ctrl);
    },
    [follow],
  );

  /** Re-attaches to a run that is still going, e.g. after a page refresh. */
  const attach = useCallback(
    async (runId: string) => {
      if (runRef.current === runId) return;
      const gen = generation.current;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      runRef.current = runId;
      seqRef.current = 0;
      setState({ runId, items: [], status: "streaming", error: null });
      let res: Response | null = null;
      try {
        res = await fetch(`/api/runs/${runId}/events?after=0`, { signal: ctrl.signal });
        if (!res.ok) res = null;
      } catch {
        res = null;
      }
      await follow(res, runId, gen, ctrl);
    },
    [follow],
  );

  /** Explicit stop. Closing the tab does not do this; the run would continue. */
  const stop = useCallback(async () => {
    const runId = runRef.current;
    if (!runId) return;
    setState((s) => ({ ...s, status: "stopping" }));
    try {
      await api(`/api/runs/${runId}/cancel`, { method: "POST" });
    } catch {
      setState((s) => ({ ...s, status: "streaming" }));
    }
  }, []);

  const reset = useCallback(() => setState((s) => (s.status === "idle" ? initial : s)), []);

  return { ...state, start, attach, stop, reset, busy: state.status !== "idle" };
}
