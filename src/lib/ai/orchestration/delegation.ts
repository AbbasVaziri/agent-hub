import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getRow as getAgentRow, type AgentRow } from "@/lib/agents/service";

export const MAX_DELEGATION_DEPTH = 1;

export class DelegationRejected extends Error {}

export function checkDelegationRules(p: {
  source: Pick<AgentRow, "id" | "delegationTargets">;
  target: Pick<AgentRow, "id" | "mode" | "isActive" | "workspaceId"> | null;
  workspaceId: string;
  depth: number;
}): void {
  if (p.depth >= MAX_DELEGATION_DEPTH) throw new DelegationRejected("Subagents cannot delegate");
  if (!p.target || p.target.workspaceId !== p.workspaceId) throw new DelegationRejected("Subagent not found");
  if (!p.source.delegationTargets.includes(p.target.id)) throw new DelegationRejected("This agent is not allowed to delegate to that subagent");
  if (p.target.id === p.source.id) throw new DelegationRejected("An agent cannot delegate to itself");
  if (p.target.mode === "primary") throw new DelegationRejected("Target agent cannot run as a subagent");
  if (!p.target.isActive) throw new DelegationRejected("Subagent is turned off");
}

export async function prepareDelegation(p: {
  workspaceId: string;
  conversationId: string;
  userId: string;
  parentRunId: string;
  source: AgentRow;
  subagentId: string;
  taskPrompt: string;
  depth: number;
}) {
  const target = await getAgentRow(p.workspaceId, p.subagentId);
  checkDelegationRules({ source: p.source, target, workspaceId: p.workspaceId, depth: p.depth });
  const agent = target as AgentRow;
  return db().transaction(async (tx) => {
    const [child] = await tx
      .insert(schema.agentRuns)
      .values({
        workspaceId: p.workspaceId,
        conversationId: p.conversationId,
        agentId: agent.id,
        userId: p.userId,
        parentRunId: p.parentRunId,
        status: "running",
        startedAt: new Date(),
      })
      .returning();
    const [delegation] = await tx
      .insert(schema.agentDelegations)
      .values({
        workspaceId: p.workspaceId,
        parentRunId: p.parentRunId,
        childRunId: child.id,
        sourceAgentId: p.source.id,
        targetAgentId: agent.id,
        taskPrompt: p.taskPrompt,
      })
      .returning();
    return { target: agent, childRun: child, delegation };
  });
}

export async function finishDelegation(delegationId: string, status: "completed" | "failed" | "cancelled") {
  await db().update(schema.agentDelegations).set({ status }).where(eq(schema.agentDelegations.id, delegationId));
}
