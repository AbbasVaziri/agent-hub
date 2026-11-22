import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/client";
import { AppError, forbidden, notFound } from "../api/errors";
import { audit } from "../audit";
import { can, canEditAgent } from "../workspaces/permissions";
import type { WorkspaceContext } from "../workspaces/service";
import { SELECTABLE_TOOLS } from "../ai/orchestration/tool-registry";
import type { AgentDTO, AgentInput } from "../contracts";

export type AgentRow = typeof schema.agentProfiles.$inferSelect;

export function toDTO(row: AgentRow, ctx: WorkspaceContext): AgentDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    role: row.role,
    personality: row.personality,
    instructions: row.instructions,
    tone: row.tone as AgentDTO["tone"],
    avatar: row.avatar as AgentDTO["avatar"],
    mode: row.mode,
    providerConnectionId: row.providerConnectionId,
    model: row.model,
    allowedTools: row.allowedTools,
    delegationTargets: row.delegationTargets,
    handoffTargets: row.handoffTargets,
    requireApproval: row.requireApproval,
    maxIterations: row.maxIterations,
    maxToolCalls: row.maxToolCalls,
    maxOutputTokens: row.maxOutputTokens,
    maxEstimatedCost: row.maxEstimatedCost,
    timeoutMs: row.timeoutMs,
    isActive: row.isActive,
    createdByUserId: row.createdByUserId,
    canEdit: canEditAgent(ctx.role, ctx.userId, { createdByUserId: row.createdByUserId ?? "" }),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function list(ctx: WorkspaceContext) {
  if (!can(ctx.role, "agents.view")) throw forbidden();
  const rows = await db().select().from(schema.agentProfiles).where(eq(schema.agentProfiles.workspaceId, ctx.workspaceId)).orderBy(asc(schema.agentProfiles.createdAt));
  return rows.map((r) => toDTO(r, ctx));
}

/** Workspace-scoped lookup. Every agent read in the runtime goes through this. */
export async function getRow(workspaceId: string, id: string): Promise<AgentRow | null> {
  const [row] = await db()
    .select()
    .from(schema.agentProfiles)
    .where(and(eq(schema.agentProfiles.id, id), eq(schema.agentProfiles.workspaceId, workspaceId)));
  return row ?? null;
}

export async function get(ctx: WorkspaceContext, id: string) {
  if (!can(ctx.role, "agents.view")) throw forbidden();
  const row = await getRow(ctx.workspaceId, id);
  if (!row) throw notFound("Agent");
  return toDTO(row, ctx);
}

/** Server-side checks for everything the builder lets a user point at. */
async function validateReferences(ctx: WorkspaceContext, input: AgentInput, selfId: string | null) {
  const unknownTools = input.allowedTools.filter((t) => !SELECTABLE_TOOLS.includes(t));
  if (unknownTools.length) throw new AppError("VALIDATION_ERROR", `Unknown tools: ${unknownTools.join(", ")}`);

  if (input.mode === "subagent" && (input.delegationTargets.length || input.handoffTargets.length)) {
    throw new AppError("VALIDATION_ERROR", "Subagents cannot delegate or hand off");
  }
  if (selfId && (input.delegationTargets.includes(selfId) || input.handoffTargets.includes(selfId))) {
    throw new AppError("VALIDATION_ERROR", "An agent cannot target itself");
  }

  const ids = [...new Set([...input.delegationTargets, ...input.handoffTargets])];
  if (ids.length) {
    const targets = await db()
      .select({ id: schema.agentProfiles.id, mode: schema.agentProfiles.mode })
      .from(schema.agentProfiles)
      .where(and(eq(schema.agentProfiles.workspaceId, ctx.workspaceId), inArray(schema.agentProfiles.id, ids)));
    const byId = new Map(targets.map((t) => [t.id, t.mode]));
    for (const t of input.delegationTargets) {
      const mode = byId.get(t);
      if (!mode) throw new AppError("VALIDATION_ERROR", "A delegation target was not found in this workspace");
      if (mode === "primary") throw new AppError("VALIDATION_ERROR", "Delegation targets must be subagents or 'all' agents");
    }
    for (const t of input.handoffTargets) {
      const mode = byId.get(t);
      if (!mode) throw new AppError("VALIDATION_ERROR", "A handoff target was not found in this workspace");
      if (mode === "subagent") throw new AppError("VALIDATION_ERROR", "Handoff targets cannot be subagent-only agents");
    }
  }

  if (input.providerConnectionId) {
    const [conn] = await db()
      .select({ id: schema.providerConnections.id })
      .from(schema.providerConnections)
      .where(and(eq(schema.providerConnections.id, input.providerConnectionId), eq(schema.providerConnections.workspaceId, ctx.workspaceId)));
    if (!conn) throw new AppError("VALIDATION_ERROR", "Provider connection not found in this workspace");
  }
}

export async function create(ctx: WorkspaceContext, input: AgentInput) {
  if (!can(ctx.role, "agents.create")) throw forbidden();
  await validateReferences(ctx, input, null);
  const [row] = await db()
    .insert(schema.agentProfiles)
    .values({ ...input, workspaceId: ctx.workspaceId, createdByUserId: ctx.userId })
    .returning();
  await audit({ workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "agent.created", targetType: "agent", targetId: row.id });
  return toDTO(row, ctx);
}

export async function update(ctx: WorkspaceContext, id: string, input: AgentInput) {
  const row = await getRow(ctx.workspaceId, id);
  if (!row) throw notFound("Agent");
  if (!canEditAgent(ctx.role, ctx.userId, { createdByUserId: row.createdByUserId ?? "" })) throw forbidden();
  await validateReferences(ctx, input, id);
  // Changing to subagent-only would strand other agents' handoff targets; drop them in one transaction.
  const updated = await db().transaction(async (tx) => {
    const [u] = await tx
      .update(schema.agentProfiles)
      .set(input)
      .where(and(eq(schema.agentProfiles.id, id), eq(schema.agentProfiles.workspaceId, ctx.workspaceId)))
      .returning();
    if (input.mode !== row.mode) await pruneTargets(tx, ctx.workspaceId, id, input.mode);
    return u;
  });
  await audit({ workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "agent.updated", targetType: "agent", targetId: id });
  return toDTO(updated, ctx);
}

type TxLike = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

async function pruneTargets(tx: TxLike, workspaceId: string, agentId: string, newMode: AgentRow["mode"] | null) {
  const others = await tx.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.workspaceId, workspaceId));
  for (const o of others) {
    if (o.id === agentId) continue;
    const dropDelegation = newMode === null || newMode === "primary";
    const dropHandoff = newMode === null || newMode === "subagent";
    const delegationTargets = dropDelegation ? o.delegationTargets.filter((t) => t !== agentId) : o.delegationTargets;
    const handoffTargets = dropHandoff ? o.handoffTargets.filter((t) => t !== agentId) : o.handoffTargets;
    if (delegationTargets.length !== o.delegationTargets.length || handoffTargets.length !== o.handoffTargets.length) {
      await tx.update(schema.agentProfiles).set({ delegationTargets, handoffTargets }).where(eq(schema.agentProfiles.id, o.id));
    }
  }
}

export async function duplicate(ctx: WorkspaceContext, id: string) {
  if (!can(ctx.role, "agents.create")) throw forbidden();
  const row = await getRow(ctx.workspaceId, id);
  if (!row) throw notFound("Agent");
  const { id: _id, createdAt: _c, updatedAt: _u, createdByUserId: _by, ...rest } = row;
  const [copy] = await db()
    .insert(schema.agentProfiles)
    .values({ ...rest, name: `${row.name} (2)`.slice(0, 60), createdByUserId: ctx.userId })
    .returning();
  await audit({ workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "agent.duplicated", targetType: "agent", targetId: copy.id, metadata: { from: id } });
  return toDTO(copy, ctx);
}

export async function remove(ctx: WorkspaceContext, id: string) {
  const row = await getRow(ctx.workspaceId, id);
  if (!row) throw notFound("Agent");
  const allowed = can(ctx.role, "agents.delete_any") || (row.createdByUserId === ctx.userId && can(ctx.role, "agents.edit_own"));
  if (!allowed) throw forbidden();
  await db().transaction(async (tx) => {
    await pruneTargets(tx, ctx.workspaceId, id, null);
    await tx.delete(schema.agentProfiles).where(and(eq(schema.agentProfiles.id, id), eq(schema.agentProfiles.workspaceId, ctx.workspaceId)));
  });
  await audit({ workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "agent.deleted", targetType: "agent", targetId: id });
}
