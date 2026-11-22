import { and, eq, gt, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { AppError, forbidden, notFound } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { can, canWriteConversation } from "@/lib/workspaces/permissions";
import type { WorkspaceContext } from "@/lib/workspaces/service";
import { notifyApproval, onApproval, type RunEmitter } from "./run-events";
import type { ExecutionBudget } from "./execution-budget";

export const APPROVAL_TTL_MS = 10 * 60_000;

export type ApprovalOutcome = "approved" | "rejected" | "expired";

/**
 * Parks a tool call until a person decides. The decision can only arrive via
 * the authenticated approve/reject endpoints, never from model output.
 */
export async function awaitApproval(p: {
  workspaceId: string;
  runId: string;
  rootRunId: string;
  toolExecutionId: string;
  toolCallId: string;
  toolName: string;
  agentId: string;
  emitter: RunEmitter;
  signal: AbortSignal;
  budget: ExecutionBudget;
}): Promise<ApprovalOutcome> {
  const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS);
  const [req] = await db()
    .insert(schema.approvalRequests)
    .values({
      workspaceId: p.workspaceId,
      runId: p.runId,
      toolExecutionId: p.toolExecutionId,
      requestedByAgentId: p.agentId,
      requestedAction: p.toolName,
      expiresAt,
    })
    .returning();
  await db().update(schema.toolExecutions).set({ approvalRequestId: req.id }).where(eq(schema.toolExecutions.id, p.toolExecutionId));
  await db().update(schema.agentRuns).set({ status: "waiting_for_approval" }).where(eq(schema.agentRuns.id, p.rootRunId));
  p.emitter.emit("approval_required", { approvalId: req.id, toolCallId: p.toolCallId, toolName: p.toolName, agentId: p.agentId, expiresAt: expiresAt.toISOString() });

  const waitStart = Date.now();
  const outcome = await new Promise<ApprovalOutcome>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      off();
      p.signal.removeEventListener("abort", onAbort);
      fn();
    };
    const check = async () => {
      const [row] = await db().select({ status: schema.approvalRequests.status }).from(schema.approvalRequests).where(eq(schema.approvalRequests.id, req.id));
      if (row?.status === "approved" || row?.status === "rejected") return finish(() => resolve(row.status as ApprovalOutcome));
      if (Date.now() >= expiresAt.getTime()) {
        const expired = await db()
          .update(schema.approvalRequests)
          .set({ status: "expired" })
          .where(and(eq(schema.approvalRequests.id, req.id), eq(schema.approvalRequests.status, "pending")))
          .returning({ id: schema.approvalRequests.id });
        if (expired.length) finish(() => resolve("expired"));
      }
    };
    const onAbort = () => finish(() => reject(p.signal.reason ?? new Error("aborted")));
    // In-process wake-up for the common case, DB polling for multi-instance deployments.
    const off = onApproval(req.id, () => void check());
    const poll = setInterval(() => void check().catch(() => undefined), 1000);
    p.signal.addEventListener("abort", onAbort, { once: true });
  });

  // Time spent waiting for a person does not count against the run timeout.
  p.budget.extendTimeout(Date.now() - waitStart);
  await db().update(schema.agentRuns).set({ status: "running" }).where(eq(schema.agentRuns.id, p.rootRunId));
  p.emitter.emit("approval_resolved", { approvalId: req.id, status: outcome });
  return outcome;
}

export async function reviewApproval(ctx: WorkspaceContext, approvalId: string, decision: "approved" | "rejected") {
  if (!can(ctx.role, "approvals.review")) throw forbidden();
  const [row] = await db()
    .select({ approval: schema.approvalRequests, conversation: schema.conversations })
    .from(schema.approvalRequests)
    .innerJoin(schema.agentRuns, eq(schema.agentRuns.id, schema.approvalRequests.runId))
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.agentRuns.conversationId))
    .where(and(eq(schema.approvalRequests.id, approvalId), eq(schema.approvalRequests.workspaceId, ctx.workspaceId)));
  if (!row) throw notFound("Approval request");
  const isOwnerOfConversation = canWriteConversation(ctx.role, ctx.userId, row.conversation);
  if (!isOwnerOfConversation && !can(ctx.role, "conversations.view_all")) throw notFound("Approval request");

  const updated = await db()
    .update(schema.approvalRequests)
    .set({ status: decision, reviewedByUserId: ctx.userId, reviewedAt: new Date() })
    .where(and(eq(schema.approvalRequests.id, approvalId), eq(schema.approvalRequests.status, "pending"), gt(schema.approvalRequests.expiresAt, new Date())))
    .returning();
  if (updated.length === 0) throw new AppError("CONFLICT", "This request was already decided or has expired");
  notifyApproval(approvalId);
  await audit({
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    action: `approval.${decision}`,
    targetType: "approval",
    targetId: approvalId,
    metadata: { tool: row.approval.requestedAction },
  });
  return updated[0];
}

export async function expireStaleApprovals() {
  await db()
    .update(schema.approvalRequests)
    .set({ status: "expired" })
    .where(and(eq(schema.approvalRequests.status, "pending"), lte(schema.approvalRequests.expiresAt, new Date())));
}
