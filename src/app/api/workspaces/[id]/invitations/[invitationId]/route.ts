import { route } from "@/lib/api/handler";
import { contextFor } from "@/lib/api/workspace-scope";
import { revokeInvitation } from "@/lib/workspaces/service";

export const DELETE = route<{ id: string; invitationId: string }>(async (_req, base, { id, invitationId }) => {
  const ctx = await contextFor(base, id);
  await revokeInvitation(ctx, invitationId);
  return { ok: true };
});
