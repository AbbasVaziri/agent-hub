import { route } from "@/lib/api/handler";
import { cancelRun } from "@/lib/ai/orchestration/orchestrator";

export const POST = route<{ id: string }>(async (_req, ctx, { id }) => cancelRun(ctx, id));
