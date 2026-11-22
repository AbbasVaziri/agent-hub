import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import type { AgentRow } from "@/lib/agents/service";

export const MAX_AUTOMATIC_HANDOFFS = 3;

export class HandoffRejected extends Error {}

/** Pure rule check, also used by unit tests. */
export function checkHandoffRules(p: {
  source: Pick<AgentRow, "id" | "handoffTargets" | "mode">;
  target: Pick<AgentRow, "id" | "mode" | "isActive" | "workspaceId"> | null;
  workspaceId: string;
  executionContext: "primary" | "subagent";
  conversation: { activeAgentId: string | null; handoffCount: number; lastHandoffFromAgentId: string | null };
}): void {
  const { source, target, conversation } = p;
  if (p.executionContext === "subagent") throw new HandoffRejected("Subagents cannot hand off");
  if (!target || target.workspaceId !== p.workspaceId) throw new HandoffRejected("Target agent not found");
  if (!source.handoffTargets.includes(target.id)) throw new HandoffRejected("This agent is not allowed to hand off to that target");
  if (target.id === source.id) throw new HandoffRejected("Cannot hand off to yourself");
  if (target.mode === "subagent") throw new HandoffRejected("Target is a subagent and cannot lead a conversation");
  if (!target.isActive) throw new HandoffRejected("Target agent is turned off");
  if (conversation.activeAgentId !== source.id) throw new HandoffRejected("This agent no longer leads the conversation");
  if (conversation.handoffCount >= MAX_AUTOMATIC_HANDOFFS) throw new HandoffRejected(`Automatic handoff limit (${MAX_AUTOMATIC_HANDOFFS}) reached for this conversation`);
  if (conversation.lastHandoffFromAgentId === target.id) throw new HandoffRejected("Cannot hand the conversation straight back to the agent that just handed it over");
}

/**
 * Moves the conversation to the target agent. The row lock makes two
 * concurrent handoffs serialise; the loser re-checks against fresh state.
 */
export async function performHandoff(p: {
  workspaceId: string;
  conversationId: string;
  runId: string;
  source: AgentRow;
  targetAgentId: string;
  summary: string;
  executionContext: "primary" | "subagent";
}): Promise<{ target: AgentRow; handoffId: string }> {
  return db().transaction(async (tx) => {
    const [conv] = await tx
      .select()
      .from(schema.conversations)
      .where(and(eq(schema.conversations.id, p.conversationId), eq(schema.conversations.workspaceId, p.workspaceId)))
      .for("update");
    if (!conv) throw new HandoffRejected("Conversation not found");
    const [target] = await tx
      .select()
      .from(schema.agentProfiles)
      .where(and(eq(schema.agentProfiles.id, p.targetAgentId), eq(schema.agentProfiles.workspaceId, p.workspaceId)));
    checkHandoffRules({ source: p.source, target: target ?? null, workspaceId: p.workspaceId, executionContext: p.executionContext, conversation: conv });
    await tx
      .update(schema.conversations)
      .set({ activeAgentId: target.id, handoffCount: conv.handoffCount + 1, lastHandoffFromAgentId: p.source.id })
      .where(eq(schema.conversations.id, conv.id));
    const [h] = await tx
      .insert(schema.agentHandoffs)
      .values({
        workspaceId: p.workspaceId,
        conversationId: conv.id,
        sourceAgentId: p.source.id,
        targetAgentId: target.id,
        kind: "automatic",
        summary: p.summary.slice(0, 4000),
        runId: p.runId,
      })
      .returning({ id: schema.agentHandoffs.id });
    return { target, handoffId: h.id };
  });
}
