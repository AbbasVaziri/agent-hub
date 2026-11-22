import { route } from "@/lib/api/handler";
import { getRunForUser } from "@/lib/ai/orchestration/orchestrator";

export const GET = route<{ id: string }>(async (_req, ctx, { id }) => {
  const r = await getRunForUser(ctx, id);
  return {
    id: r.id,
    conversationId: r.conversationId,
    agentId: r.agentId,
    parentRunId: r.parentRunId,
    status: r.status,
    errorCode: r.errorCode,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    iterations: r.iterations,
    toolCalls: r.toolCalls,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    estimatedCost: r.estimatedCost,
    costIsEstimate: true,
  };
});
