import { route } from "@/lib/api/handler";
import { contextFor } from "@/lib/api/workspace-scope";
import { listMembers } from "@/lib/workspaces/service";

export const GET = route<{ id: string }>(async (_req, base, { id }) => {
  const ctx = await contextFor(base, id);
  return { items: await listMembers(ctx), currentUserId: ctx.userId, role: ctx.role };
});
