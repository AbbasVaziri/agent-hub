import { z } from "zod";
import { route, parseQuery } from "@/lib/api/handler";
import { getRunForUser } from "@/lib/ai/orchestration/orchestrator";
import { runEventStream } from "@/lib/ai/orchestration/stream-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reconnect endpoint: replays events after `after` (or Last-Event-ID), then follows live. */
export const GET = route<{ id: string }>(async (req, ctx, { id }) => {
  await getRunForUser(ctx, id);
  const { after } = parseQuery(req, z.object({ after: z.coerce.number().int().min(0).optional() }));
  const header = Number(req.headers.get("last-event-id") ?? 0) || 0;
  return runEventStream(id, Math.max(after ?? 0, header), req.signal);
});
