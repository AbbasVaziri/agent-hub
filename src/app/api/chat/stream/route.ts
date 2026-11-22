import { route, parseBody } from "@/lib/api/handler";
import { chatStreamSchema } from "@/lib/contracts";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/security/rate-limit";
import { createOrAttachRun } from "@/lib/ai/orchestration/orchestrator";
import { runEventStream } from "@/lib/ai/orchestration/stream-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts (or re-attaches to) a run and streams its events as SSE.
 * Closing the connection does not cancel the run; POST /api/runs/:id/cancel does.
 */
export const POST = route(async (req, ctx) => {
  const input = await parseBody(req, chatStreamSchema);
  await rateLimit(`chat:${ctx.userId}`, env().RATE_LIMIT_CHAT_PER_MINUTE, 60);
  const { runId } = await createOrAttachRun(ctx, input);
  const after = Number(req.headers.get("last-event-id") ?? 0) || 0;
  return runEventStream(runId, after, req.signal);
});
