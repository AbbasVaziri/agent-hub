import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { AppError, forbidden, notFound } from "../api/errors";
import { audit } from "../audit";
import { can, canViewConversation, canWriteConversation } from "../workspaces/permissions";
import type { WorkspaceContext } from "../workspaces/service";
import { getRow as getAgentRow } from "../agents/service";
import type { ConversationDTO, MessageDTO, TimelineItem } from "../contracts";

export type ConversationRow = typeof schema.conversations.$inferSelect;

export function toDTO(row: ConversationRow, ctx: WorkspaceContext): ConversationDTO {
  return {
    id: row.id,
    title: row.title,
    activeAgentId: row.activeAgentId,
    providerConnectionId: row.providerConnectionId,
    model: row.model,
    handoffCount: row.handoffCount,
    visibility: row.visibility,
    status: row.status,
    createdByUserId: row.createdByUserId,
    canWrite: canWriteConversation(ctx.role, ctx.userId, row),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function messageDTO(m: typeof schema.messages.$inferSelect): MessageDTO {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    agentId: m.agentId,
    runId: m.runId,
    status: m.status,
    errorCode: m.errorCode,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function list(ctx: WorkspaceContext, opts: { cursor?: string; limit: number; status?: "active" | "archived" }) {
  const c = schema.conversations;
  const visibility = can(ctx.role, "conversations.view_all")
    ? sql`true`
    : or(eq(c.createdByUserId, ctx.userId), can(ctx.role, "conversations.view_shared") ? eq(c.visibility, "workspace") : sql`false`);
  const rows = await db()
    .select()
    .from(c)
    .where(
      and(
        eq(c.workspaceId, ctx.workspaceId),
        eq(c.status, opts.status ?? "active"),
        visibility,
        opts.cursor ? sql`${c.updatedAt} < ${new Date(opts.cursor)}` : undefined,
      ),
    )
    .orderBy(desc(c.updatedAt))
    .limit(opts.limit + 1);
  const page = rows.slice(0, opts.limit);
  return { items: page.map((r) => toDTO(r, ctx)), nextCursor: rows.length > opts.limit ? page[page.length - 1].updatedAt.toISOString() : null };
}

export async function getRow(ctx: WorkspaceContext, id: string): Promise<ConversationRow> {
  const [row] = await db()
    .select()
    .from(schema.conversations)
    .where(and(eq(schema.conversations.id, id), eq(schema.conversations.workspaceId, ctx.workspaceId)));
  // Hidden and missing look the same to the caller.
  if (!row || !canViewConversation(ctx.role, ctx.userId, row)) throw notFound("Conversation");
  return row;
}

export async function getWritable(ctx: WorkspaceContext, id: string) {
  const row = await getRow(ctx, id);
  if (!canWriteConversation(ctx.role, ctx.userId, row)) throw forbidden("Only the creator can post in this conversation");
  return row;
}

async function assertConversationAgent(workspaceId: string, agentId: string) {
  const agent = await getAgentRow(workspaceId, agentId);
  if (!agent) throw new AppError("VALIDATION_ERROR", "Agent not found in this workspace");
  if (!agent.isActive) throw new AppError("VALIDATION_ERROR", "This agent is turned off");
  if (agent.mode === "subagent") throw new AppError("VALIDATION_ERROR", "Subagents cannot lead a conversation");
  return agent;
}

export async function create(ctx: WorkspaceContext, input: { agentId?: string | null; title?: string }) {
  if (!can(ctx.role, "conversations.create")) throw forbidden();
  if (input.agentId) await assertConversationAgent(ctx.workspaceId, input.agentId);
  const [row] = await db()
    .insert(schema.conversations)
    .values({ workspaceId: ctx.workspaceId, createdByUserId: ctx.userId, activeAgentId: input.agentId ?? null, title: input.title ?? "" })
    .returning();
  return toDTO(row, ctx);
}

export async function update(
  ctx: WorkspaceContext,
  id: string,
  input: { title?: string; visibility?: "private" | "workspace"; status?: "active" | "archived"; providerConnectionId?: string | null; model?: string | null },
) {
  await getWritable(ctx, id);
  if (input.providerConnectionId) {
    const [conn] = await db()
      .select({ id: schema.providerConnections.id })
      .from(schema.providerConnections)
      .where(and(eq(schema.providerConnections.id, input.providerConnectionId), eq(schema.providerConnections.workspaceId, ctx.workspaceId)));
    if (!conn) throw new AppError("VALIDATION_ERROR", "Provider connection not found in this workspace");
  }
  if (input.providerConnectionId === null) input.model = null;
  const [row] = await db().update(schema.conversations).set(input).where(eq(schema.conversations.id, id)).returning();
  return toDTO(row, ctx);
}

export async function remove(ctx: WorkspaceContext, id: string) {
  const row = await getRow(ctx, id);
  if (row.createdByUserId !== ctx.userId && ctx.role !== "owner") throw forbidden();
  await db().delete(schema.conversations).where(eq(schema.conversations.id, id));
  await audit({ workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "conversation.deleted", targetId: id });
}

/** Manual switch by the user. It does not count toward the automatic handoff limit. */
export async function switchAgent(ctx: WorkspaceContext, id: string, agentId: string) {
  const conv = await getWritable(ctx, id);
  if (conv.activeAgentId === agentId) return toDTO(conv, ctx);
  await assertConversationAgent(ctx.workspaceId, agentId);
  const row = await db().transaction(async (tx) => {
    const [u] = await tx.update(schema.conversations).set({ activeAgentId: agentId }).where(eq(schema.conversations.id, id)).returning();
    await tx.insert(schema.agentHandoffs).values({
      workspaceId: ctx.workspaceId,
      conversationId: id,
      sourceAgentId: conv.activeAgentId,
      targetAgentId: agentId,
      kind: "manual",
      byUserId: ctx.userId,
    });
    return u;
  });
  return toDTO(row, ctx);
}

export async function timeline(ctx: WorkspaceContext, id: string): Promise<TimelineItem[]> {
  await getRow(ctx, id);
  const [msgs, handoffs, tools, approvals] = await Promise.all([
    db().select().from(schema.messages).where(eq(schema.messages.conversationId, id)).orderBy(asc(schema.messages.createdAt)),
    db().select().from(schema.agentHandoffs).where(eq(schema.agentHandoffs.conversationId, id)),
    db()
      .select({
        id: schema.toolExecutions.id,
        runId: schema.toolExecutions.runId,
        toolName: schema.toolExecutions.toolName,
        status: schema.toolExecutions.status,
        durationMs: schema.toolExecutions.durationMs,
        createdAt: schema.toolExecutions.createdAt,
      })
      .from(schema.toolExecutions)
      .innerJoin(schema.agentRuns, eq(schema.agentRuns.id, schema.toolExecutions.runId))
      .where(and(eq(schema.agentRuns.conversationId, id), sql`${schema.agentRuns.parentRunId} is null`)),
    db()
      .select({
        id: schema.approvalRequests.id,
        runId: schema.approvalRequests.runId,
        action: schema.approvalRequests.requestedAction,
        status: schema.approvalRequests.status,
        createdAt: schema.approvalRequests.createdAt,
      })
      .from(schema.approvalRequests)
      .innerJoin(schema.agentRuns, eq(schema.agentRuns.id, schema.approvalRequests.runId))
      .where(eq(schema.agentRuns.conversationId, id)),
  ]);
  const items: TimelineItem[] = [
    ...msgs.map((m): TimelineItem => ({ kind: "message", at: m.createdAt.toISOString(), message: messageDTO(m) })),
    ...handoffs.map(
      (h): TimelineItem => ({ kind: "handoff", at: h.createdAt.toISOString(), id: h.id, runId: h.runId, fromAgentId: h.sourceAgentId, toAgentId: h.targetAgentId, summary: h.summary, mode: h.kind }),
    ),
    ...tools.map((t): TimelineItem => ({ kind: "tool", at: t.createdAt.toISOString(), id: t.id, runId: t.runId, toolName: t.toolName, status: t.status, durationMs: t.durationMs })),
    ...approvals.map((a): TimelineItem => ({ kind: "approval", at: a.createdAt.toISOString(), id: a.id, runId: a.runId, action: a.action, status: a.status })),
  ];
  return items.sort((a, b) => a.at.localeCompare(b.at));
}
