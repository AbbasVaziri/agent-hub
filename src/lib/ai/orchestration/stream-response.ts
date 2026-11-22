import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { formatSse } from "@/lib/sse/parser";
import type { RunEvent } from "../events";
import { activeRuns, replayEvents, subscribe } from "./run-events";

const HEARTBEAT_MS = 15_000;
const POLL_MS = 700;

/**
 * SSE view of a run's event log: replay after `afterSeq`, then live events.
 * Closing the response only unsubscribes; the run keeps going.
 */
export function runEventStream(runId: string, afterSeq: number, requestSignal: AbortSignal): Response {
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastSeq = afterSeq;
      let closed = false;
      const buffered: RunEvent[] = [];
      let replaying = true;

      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const send = (e: RunEvent) => {
        if (closed || e.seq <= lastSeq) return;
        lastSeq = e.seq;
        controller.enqueue(encoder.encode(formatSse(e.type, e.data, e.seq)));
        if (e.type === "done") close();
      };

      const unsubscribe = subscribe(runId, (e) => (replaying ? buffered.push(e) : send(e)));
      const heartbeat = setInterval(() => !closed && controller.enqueue(encoder.encode(`: ping\n\n`)), HEARTBEAT_MS);
      // When the run lives in another process (or already finished), fall back to polling the log.
      const poll = setInterval(async () => {
        if (closed || activeRuns.has(runId)) return;
        for (const e of await replayEvents(runId, lastSeq)) send(e);
        if (!closed) {
          const [r] = await db().select({ status: schema.agentRuns.status }).from(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
          if (r && ["completed", "failed", "cancelled"].includes(r.status)) {
            for (const e of await replayEvents(runId, lastSeq)) send(e);
            close();
          }
        }
      }, POLL_MS);
      const onAbort = () => close();
      requestSignal.addEventListener("abort", onAbort, { once: true });
      cleanup = () => {
        unsubscribe();
        clearInterval(heartbeat);
        clearInterval(poll);
        requestSignal.removeEventListener("abort", onAbort);
      };

      controller.enqueue(encoder.encode(`retry: 2000\n\n`));
      for (const e of await replayEvents(runId, afterSeq)) send(e);
      replaying = false;
      for (const e of buffered.sort((a, b) => a.seq - b.seq)) send(e);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
