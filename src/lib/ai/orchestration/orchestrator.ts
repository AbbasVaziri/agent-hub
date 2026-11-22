import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { AppError, forbidden, notFound } from "@/lib/api/errors";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { getRow as getAgentRow, type AgentRow } from "@/lib/agents/service";
import { getRow as getConversationRow, getWritable } from "@/lib/conversations/service";
import type { WorkspaceContext } from "@/lib/workspaces/service";
import type { ChatStreamInput } from "@/lib/contracts";
import { buildMessages, type HistoryMessage } from "../chat/chat-context";
import { USER_ERROR_TEXT } from "../events";
import { buildSystemPrompt, limitsFor, RunFailure, runAgentTurns, type RunScope } from "./agent-runtime";
import { ExecutionBudget, PLATFORM_CEILINGS } from "./execution-budget";
import { activeRuns, RunEmitter } from "./run-events";

class CancelledByUser extends Error {
  constructor() {
    super("Cancelled by user");
  }
}

const NON_TERMINAL = ["queued", "running", "waiting_for_approval"] as const;

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

async function monthlySpend(workspaceId: string): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const [row] = await db()
    .select({ total: sql<string>`coalesce(sum(${schema.usageRecords.estimatedCost}), 0)` })
    .from(schema.usageRecords)
    .where(and(eq(schema.usageRecords.workspaceId, workspaceId), gte(schema.usageRecords.createdAt, start)));
  return Number(row?.total ?? 0);
}

/** Runs left non-terminal by a crashed process are marked failed so quotas free up. */
export async function reapStaleRuns(workspaceId: string) {
  const cutoff = new Date(Date.now() - PLATFORM_CEILINGS.timeoutMs - 60_000);
  const stale = await db()
    .select({ id: schema.agentRuns.id })
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.workspaceId, workspaceId), inArray(schema.agentRuns.status, [...NON_TERMINAL]), lt(schema.agentRuns.createdAt, cutoff)));
  for (const r of stale) {
    if (activeRuns.has(r.id)) continue;
    await db().update(schema.agentRuns).set({ status: "failed", errorCode: "INTERRUPTED", finishedAt: new Date() }).where(eq(schema.agentRuns.id, r.id));
  }
}

export type StartedRun = { runId: string; created: boolean };

/**
 * Creates the user message, assistant placeholder and run in one transaction,
 * or returns the existing run when the same clientMessageId is seen again.
 */
export async function createOrAttachRun(ctx: WorkspaceContext, input: ChatStreamInput): Promise<StartedRun> {
  const conv = await getWritable(ctx, input.conversationId);

  const existing = await db()
    .select({ id: schema.agentRuns.id })
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.workspaceId, ctx.workspaceId), eq(schema.agentRuns.idempotencyKey, input.clientMessageId)));
  if (existing[0]) return { runId: existing[0].id, created: false };

  if (!conv.activeAgentId) throw new AppError("VALIDATION_ERROR", "Choose an agent for this conversation first");
  const agent = await getAgentRow(ctx.workspaceId, conv.activeAgentId);
  if (!agent || !agent.isActive || agent.mode === "subagent") throw new AppError("VALIDATION_ERROR", "The conversation's agent is unavailable");

  await reapStaleRuns(ctx.workspaceId);
  const e = env();
  const running = await db()
    .select({ id: schema.agentRuns.id, conversationId: schema.agentRuns.conversationId })
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.workspaceId, ctx.workspaceId), isNull(schema.agentRuns.parentRunId), inArray(schema.agentRuns.status, [...NON_TERMINAL])));
  if (running.some((r) => r.conversationId === conv.id)) throw new AppError("CONFLICT", "A reply is already being generated in this conversation");
  if (running.length >= e.MAX_CONCURRENT_RUNS_PER_WORKSPACE) throw new AppError("RATE_LIMITED", "Too many replies are running in this workspace right now");

  const [ws] = await db().select({ budget: schema.workspaces.monthlyBudgetUsd }).from(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspaceId));
  const budget = ws?.budget ?? e.MONTHLY_BUDGET_USD_PER_WORKSPACE;
  if ((await monthlySpend(ctx.workspaceId)) >= budget) throw new AppError("BUDGET_EXCEEDED", USER_ERROR_TEXT.BUDGET_EXCEEDED.en);

  try {
    const runId = await db().transaction(async (tx) => {
      // now() is fixed inside a transaction, so order the two messages explicitly.
      const userAt = new Date();
      const replyAt = new Date(userAt.getTime() + 1);
      let userMessageId: string;
      if (input.retryOfMessageId) {
        const [orig] = await tx
          .select()
          .from(schema.messages)
          .where(and(eq(schema.messages.id, input.retryOfMessageId), eq(schema.messages.conversationId, conv.id), eq(schema.messages.role, "user")));
        if (!orig) throw notFound("Message");
        userMessageId = orig.id;
        // A retry replaces the failed reply instead of stacking another one.
        await tx
          .delete(schema.messages)
          .where(and(eq(schema.messages.conversationId, conv.id), eq(schema.messages.role, "assistant"), inArray(schema.messages.status, ["failed", "cancelled"]), sql`${schema.messages.createdAt} > ${orig.createdAt}`));
      } else {
        const [um] = await tx
          .insert(schema.messages)
          .values({
            workspaceId: ctx.workspaceId,
            conversationId: conv.id,
            role: "user",
            content: input.content,
            parts: [{ type: "text", text: input.content }],
            clientMessageId: input.clientMessageId,
            createdAt: userAt,
          })
          .returning();
        userMessageId = um.id;
      }
      const [run] = await tx
        .insert(schema.agentRuns)
        .values({
          workspaceId: ctx.workspaceId,
          conversationId: conv.id,
          agentId: agent.id,
          userId: ctx.userId,
          status: "queued",
          idempotencyKey: input.clientMessageId,
          providerConnectionId: agent.providerConnectionId,
          model: agent.model,
        })
        .returning();
      const [am] = await tx
        .insert(schema.messages)
        .values({ workspaceId: ctx.workspaceId, conversationId: conv.id, role: "assistant", agentId: agent.id, runId: run.id, status: "streaming", createdAt: replyAt })
        .returning();
      await tx.update(schema.agentRuns).set({ assistantMessageId: am.id }).where(eq(schema.agentRuns.id, run.id));
      await tx.update(schema.messages).set({ runId: run.id }).where(eq(schema.messages.id, userMessageId));
      const title = conv.title || input.content.replace(/\s+/g, " ").slice(0, 60);
      await tx.update(schema.conversations).set({ title, updatedAt: new Date() }).where(eq(schema.conversations.id, conv.id));
      return { runId: run.id, userMessageId };
    });
    void executeRun(runId.runId, runId.userMessageId).catch((err) => log.error("Run crashed", { err, runId: runId.runId }));
    return { runId: runId.runId, created: true };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const [r] = await db()
        .select({ id: schema.agentRuns.id })
        .from(schema.agentRuns)
        .where(and(eq(schema.agentRuns.workspaceId, ctx.workspaceId), eq(schema.agentRuns.idempotencyKey, input.clientMessageId)));
      if (r) return { runId: r.id, created: false };
    }
    throw err;
  }
}

async function loadHistory(conversationId: string, beforeMessageId: string): Promise<HistoryMessage[]> {
  const rows = await db()
    .select({ id: schema.messages.id, role: schema.messages.role, content: schema.messages.content, status: schema.messages.status })
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(asc(schema.messages.createdAt));
  const out: HistoryMessage[] = [];
  for (const r of rows) {
    if (r.id === beforeMessageId) break;
    if (r.role === "system" || !r.content.trim()) continue;
    if (r.role === "assistant" && r.status === "failed") continue;
    out.push({ role: r.role, content: r.content });
  }
  return out;
}

/**
 * Executes a root run detached from the HTTP request. A closed browser tab
 * does not stop it; only an explicit cancel or a limit does.
 */
export async function executeRun(runId: string, _userMessageId?: string): Promise<void> {
  const [run] = await db().select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
  if (!run || run.status !== "queued") return;
  const [conv] = await db().select().from(schema.conversations).where(eq(schema.conversations.id, run.conversationId));
  const [user] = await db().select({ locale: schema.users.locale }).from(schema.users).where(eq(schema.users.id, run.userId ?? ""));
  const emitter = new RunEmitter(run.id, run.workspaceId);
  const ctrl = new AbortController();
  activeRuns.register(run.id, ctrl);
  const overall = setTimeout(() => ctrl.abort(new AppError("LIMIT_EXCEEDED", "Execution limit reached: timeoutMs")), PLATFORM_CEILINGS.timeoutMs + 5 * 60_000);
  // Cross-instance cancel: another app instance may have set cancel_requested_at.
  const cancelWatch = setInterval(async () => {
    const [r] = await db().select({ c: schema.agentRuns.cancelRequestedAt }).from(schema.agentRuns).where(eq(schema.agentRuns.id, run.id));
    if (r?.c && !ctrl.signal.aborted) ctrl.abort(new CancelledByUser());
  }, 1500);

  const scope: RunScope = {
    workspaceId: run.workspaceId,
    conversationId: run.conversationId,
    userId: run.userId ?? "",
    rootRunId: run.id,
    locale: user?.locale === "en" ? "en" : "fa",
    timeZone: "Asia/Tehran",
  };

  let messageId = run.assistantMessageId!;
  let buffer = "";
  let lastFlush = Date.now();
  const flush = async (status?: "completed" | "failed" | "cancelled", errorCode?: string) => {
    lastFlush = Date.now();
    await db()
      .update(schema.messages)
      .set({ content: buffer, ...(status ? { status } : {}), ...(errorCode ? { errorCode } : {}) })
      .where(eq(schema.messages.id, messageId));
  };
  const totals = { input: 0, output: 0, cost: 0, iterations: 0, toolCalls: 0 };
  const addTotals = (b: ExecutionBudget) => {
    totals.input += b.usage.inputTokens;
    totals.output += b.usage.outputTokens;
    totals.cost += b.usage.estimatedCost;
    totals.iterations += b.usage.iterations;
    totals.toolCalls += b.usage.toolCalls;
  };

  let finalStatus: "completed" | "failed" | "cancelled" = "completed";
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  try {
    await db().update(schema.agentRuns).set({ status: "running", startedAt: new Date() }).where(eq(schema.agentRuns.id, run.id));
    const userMsg = await db()
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(and(eq(schema.messages.runId, run.id), eq(schema.messages.role, "user")));
    emitter.emit("run", { runId: run.id, conversationId: run.conversationId, messageId, agentId: run.agentId, userMessageId: userMsg[0]?.id ?? "" });

    let agent: AgentRow | null = conv?.activeAgentId ? await getAgentRow(run.workspaceId, conv.activeAgentId) : null;
    if (!agent || !agent.isActive || agent.mode === "subagent") throw new RunFailure("AGENT_UNAVAILABLE", "Agent unavailable");
    let handoffNote: { fromAgentName: string | null; summary: string } | undefined;
    const history = await loadHistory(run.conversationId, messageId);

    for (;;) {
      const budget = new ExecutionBudget(limitsFor(agent));
      const system = await buildSystemPrompt(scope, agent, "primary", handoffNote);
      try {
        const result = await runAgentTurns({
          scope,
          runId: run.id,
          agent,
          executionContext: "primary",
          depth: 0,
          messages: buildMessages(system, history),
          emitter,
          signal: ctrl.signal,
          budget,
          modelOverride: conv?.providerConnectionId ? { providerConnectionId: conv.providerConnectionId, model: conv.model } : null,
          onText: (text) => {
            buffer += text;
            emitter.emit("chunk", { text, messageId });
            if (Date.now() - lastFlush > 1500) void flush();
          },
        });
        addTotals(budget);
        if (!result.handoff) break;

        await flush("completed");
        if (buffer) history.push({ role: "assistant", content: buffer });
        const from = agent;
        agent = result.handoff.target;
        const [next] = await db()
          .insert(schema.messages)
          .values({ workspaceId: run.workspaceId, conversationId: run.conversationId, role: "assistant", agentId: agent.id, runId: run.id, status: "streaming" })
          .returning();
        messageId = next.id;
        buffer = "";
        handoffNote = { fromAgentName: from.name, summary: result.handoff.summary };
        emitter.emit("handoff", { fromAgentId: from.id, toAgentId: agent.id, summary: result.handoff.summary, messageId });
      } catch (err) {
        addTotals(budget);
        throw err;
      }
    }
    await flush("completed");
  } catch (err) {
    const reason = ctrl.signal.aborted ? ctrl.signal.reason : err;
    if (reason instanceof CancelledByUser) {
      finalStatus = "cancelled";
      errorCode = "CANCELLED";
      await flush("cancelled");
    } else {
      finalStatus = "failed";
      if (reason instanceof RunFailure) {
        errorCode = reason.code;
        errorMessage = reason.message;
      } else if (reason instanceof AppError) {
        errorCode = reason.code;
        errorMessage = reason.message;
      } else {
        errorCode = "INTERNAL_ERROR";
        log.error("Run failed", { err: reason, runId: run.id });
      }
      await flush("failed", errorCode);
      const text = USER_ERROR_TEXT[errorCode] ?? USER_ERROR_TEXT.INTERNAL_ERROR;
      emitter.emit("error", { code: errorCode, message: scope.locale === "fa" ? text.fa : text.en, messageId });
    }
  } finally {
    clearTimeout(overall);
    clearInterval(cancelWatch);
    await db().update(schema.conversations).set({ updatedAt: new Date() }).where(eq(schema.conversations.id, run.conversationId));
    // Children of a cancelled or failed parent must not be left looking alive.
    await db()
      .update(schema.agentRuns)
      .set({ status: finalStatus === "completed" ? "failed" : finalStatus, finishedAt: new Date() })
      .where(and(eq(schema.agentRuns.parentRunId, run.id), inArray(schema.agentRuns.status, [...NON_TERMINAL])));
    await db()
      .update(schema.approvalRequests)
      .set({ status: "expired" })
      .where(and(eq(schema.approvalRequests.runId, run.id), eq(schema.approvalRequests.status, "pending")));
    // The event log is complete before the run is marked terminal, so pollers never miss the tail.
    emitter.emit("done", { messageId, runId: run.id, status: finalStatus });
    await emitter.drain();
    await db()
      .update(schema.agentRuns)
      .set({
        status: finalStatus,
        finishedAt: new Date(),
        errorCode,
        errorMessage: errorMessage?.slice(0, 500) ?? null,
        inputTokens: totals.input,
        outputTokens: totals.output,
        estimatedCost: totals.cost,
        iterations: totals.iterations,
        toolCalls: totals.toolCalls,
      })
      .where(eq(schema.agentRuns.id, run.id));
    activeRuns.unregister(run.id);
  }
}

export async function getRunForUser(ctx: WorkspaceContext, runId: string) {
  const [run] = await db()
    .select()
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.id, runId), eq(schema.agentRuns.workspaceId, ctx.workspaceId)));
  if (!run) throw notFound("Run");
  await getConversationRow(ctx, run.conversationId);
  return run;
}

/** Explicit stop from the user. Only the conversation's creator can stop its runs. */
export async function cancelRun(ctx: WorkspaceContext, runId: string) {
  const run = await getRunForUser(ctx, runId);
  const conv = await getConversationRow(ctx, run.conversationId);
  if (conv.createdByUserId !== ctx.userId) throw forbidden();
  if (!NON_TERMINAL.includes(run.status as (typeof NON_TERMINAL)[number])) return { status: run.status };
  await db().update(schema.agentRuns).set({ cancelRequestedAt: new Date() }).where(eq(schema.agentRuns.id, runId));
  const local = activeRuns.get(runId);
  if (local) local.abort(new CancelledByUser());
  return { status: "cancelling" };
}
