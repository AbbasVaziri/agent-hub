import { route } from "@/lib/api/handler";
import { reviewApproval } from "@/lib/ai/orchestration/approval-engine";

export const POST = route<{ id: string }>(async (_req, ctx, { id }) => {
  const a = await reviewApproval(ctx, id, "rejected");
  return { id: a.id, status: a.status };
});
