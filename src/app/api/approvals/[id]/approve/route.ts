import { route } from "@/lib/api/handler";
import { reviewApproval } from "@/lib/ai/orchestration/approval-engine";

export const POST = route<{ id: string }>(async (_req, ctx, { id }) => {
  const a = await reviewApproval(ctx, id, "approved");
  return { id: a.id, status: a.status };
});
