import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { route } from "@/lib/api/handler";
import { db, schema } from "@/lib/db/client";
import * as conversations from "@/lib/conversations/service";

/** Full timeline plus the run still in progress, so a refreshed page can reattach. */
export const GET = route<{ id: string }>(async (_req, ctx, { id }) => {
  const items = await conversations.timeline(ctx, id);
  const [active] = await db()
    .select({ id: schema.agentRuns.id, status: schema.agentRuns.status })
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.conversationId, id), isNull(schema.agentRuns.parentRunId), inArray(schema.agentRuns.status, ["queued", "running", "waiting_for_approval"])))
    .orderBy(desc(schema.agentRuns.createdAt))
    .limit(1);
  return { items, activeRun: active ?? null };
});
