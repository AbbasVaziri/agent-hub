import { EventEmitter } from "node:events";
import { and, asc, eq, gt } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { log } from "@/lib/logger";
import type { RunEvent, RunEventData, RunEventType } from "../events";

const g = globalThis as unknown as { __runBus?: EventEmitter };
const bus = (g.__runBus ??= new EventEmitter().setMaxListeners(0));

/**
 * Writes every event to run_events before publishing it, so a client that
 * reconnects can replay from its last seq. Text chunks are coalesced to keep
 * row counts reasonable.
 */
export class RunEmitter {
  private seq = 0;
  private pendingChunk: { text: string; messageId: string } | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    readonly rootRunId: string,
    readonly workspaceId: string,
  ) {}

  emit<T extends RunEventType>(type: T, data: RunEventData<T>): void {
    if (type === "chunk") {
      const c = data as RunEventData<"chunk">;
      if (this.pendingChunk && this.pendingChunk.messageId === c.messageId) this.pendingChunk.text += c.text;
      else {
        this.flushChunk();
        this.pendingChunk = { ...c };
      }
      this.flushTimer ??= setTimeout(() => this.flushChunk(), 60);
      return;
    }
    this.flushChunk();
    this.write(type, data);
  }

  private flushChunk() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.pendingChunk) return;
    const c = this.pendingChunk;
    this.pendingChunk = null;
    this.write("chunk", c);
  }

  private write(type: RunEventType, data: unknown) {
    const seq = ++this.seq;
    const event = { type, data, seq } as RunEvent;
    this.chain = this.chain
      .then(async () => {
        await db().insert(schema.runEvents).values({ workspaceId: this.workspaceId, runId: this.rootRunId, seq, type, data: data as object });
      })
      .catch((err) => log.error("Failed to persist run event", { err, runId: this.rootRunId, type }))
      .then(() => {
        bus.emit(this.rootRunId, event);
      });
  }

  /** Resolves once every emitted event is persisted and published. */
  async drain(): Promise<void> {
    this.flushChunk();
    await this.chain;
  }
}

export async function replayEvents(runId: string, afterSeq: number): Promise<RunEvent[]> {
  const rows = await db()
    .select()
    .from(schema.runEvents)
    .where(and(eq(schema.runEvents.runId, runId), gt(schema.runEvents.seq, afterSeq)))
    .orderBy(asc(schema.runEvents.seq));
  return rows.map((r) => ({ type: r.type, data: r.data, seq: r.seq }) as RunEvent);
}

export function subscribe(runId: string, fn: (e: RunEvent) => void): () => void {
  bus.on(runId, fn);
  return () => bus.off(runId, fn);
}

/** Local in-process signal used to wake runs waiting on an approval decision. */
export function notifyApproval(approvalId: string) {
  bus.emit(`approval:${approvalId}`);
}
export function onApproval(approvalId: string, fn: () => void): () => void {
  bus.on(`approval:${approvalId}`, fn);
  return () => bus.off(`approval:${approvalId}`, fn);
}

const active = ((globalThis as unknown as { __activeRuns?: Map<string, AbortController> }).__activeRuns ??= new Map());

export const activeRuns = {
  register(runId: string, ctrl: AbortController) {
    active.set(runId, ctrl);
  },
  unregister(runId: string) {
    active.delete(runId);
  },
  get(runId: string) {
    return active.get(runId);
  },
  has(runId: string) {
    return active.has(runId);
  },
};
