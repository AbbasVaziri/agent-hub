import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { env } from "../env";
import { forbidden } from "../api/errors";
import { can } from "../workspaces/permissions";
import type { WorkspaceContext } from "../workspaces/service";

export async function usageSummary(ctx: WorkspaceContext, days: number) {
  if (!can(ctx.role, "usage.view")) throw forbidden();
  const since = new Date(Date.now() - days * 86_400_000);
  const u = schema.usageRecords;
  const where = and(eq(u.workspaceId, ctx.workspaceId), gte(u.createdAt, since));

  const [totals] = await db()
    .select({
      requests: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${u.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${u.outputTokens}), 0)::int`,
      estimatedCost: sql<number>`coalesce(sum(${u.estimatedCost}), 0)::float`,
    })
    .from(u)
    .where(where);

  const byModel = await db()
    .select({
      model: u.model,
      providerType: u.providerType,
      requests: sql<number>`count(*)::int`,
      inputTokens: sql<number>`sum(${u.inputTokens})::int`,
      outputTokens: sql<number>`sum(${u.outputTokens})::int`,
      estimatedCost: sql<number>`sum(${u.estimatedCost})::float`,
    })
    .from(u)
    .where(where)
    .groupBy(u.model, u.providerType)
    .orderBy(desc(sql`sum(${u.estimatedCost})`));

  const byDay = await db()
    .select({
      day: sql<string>`to_char(date_trunc('day', ${u.createdAt}), 'YYYY-MM-DD')`,
      estimatedCost: sql<number>`sum(${u.estimatedCost})::float`,
      tokens: sql<number>`sum(${u.inputTokens} + ${u.outputTokens})::int`,
    })
    .from(u)
    .where(where)
    .groupBy(sql`date_trunc('day', ${u.createdAt})`)
    .orderBy(sql`date_trunc('day', ${u.createdAt})`);

  const byAgent = await db()
    .select({
      agentId: u.agentId,
      name: schema.agentProfiles.name,
      requests: sql<number>`count(*)::int`,
      estimatedCost: sql<number>`sum(${u.estimatedCost})::float`,
    })
    .from(u)
    .leftJoin(schema.agentProfiles, eq(schema.agentProfiles.id, u.agentId))
    .where(where)
    .groupBy(u.agentId, schema.agentProfiles.name)
    .orderBy(desc(sql`sum(${u.estimatedCost})`));

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [month] = await db()
    .select({ cost: sql<number>`coalesce(sum(${u.estimatedCost}), 0)::float` })
    .from(u)
    .where(and(eq(u.workspaceId, ctx.workspaceId), gte(u.createdAt, monthStart)));
  const [ws] = await db().select({ budget: schema.workspaces.monthlyBudgetUsd }).from(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspaceId));

  return {
    days,
    totals,
    byModel,
    byDay,
    byAgent,
    month: { estimatedCost: month.cost, budgetUsd: ws?.budget ?? env().MONTHLY_BUDGET_USD_PER_WORKSPACE },
    costIsEstimate: true,
  };
}

export async function auditLog(ctx: WorkspaceContext, limit: number) {
  if (!can(ctx.role, "audit.view")) throw forbidden();
  return db()
    .select({
      id: schema.auditLogs.id,
      action: schema.auditLogs.action,
      actorName: schema.users.name,
      targetType: schema.auditLogs.targetType,
      targetId: schema.auditLogs.targetId,
      metadata: schema.auditLogs.metadata,
      createdAt: schema.auditLogs.createdAt,
    })
    .from(schema.auditLogs)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorUserId))
    .where(eq(schema.auditLogs.workspaceId, ctx.workspaceId))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(limit);
}
