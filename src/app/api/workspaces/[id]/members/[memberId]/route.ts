import { route, parseBody } from "@/lib/api/handler";
import { contextFor } from "@/lib/api/workspace-scope";
import { memberRoleSchema } from "@/lib/contracts";
import { changeMemberRole, removeMember } from "@/lib/workspaces/service";

type P = { id: string; memberId: string };

export const PATCH = route<P>(async (req, base, { id, memberId }) => {
  const ctx = await contextFor(base, id);
  const { role } = await parseBody(req, memberRoleSchema);
  await changeMemberRole(ctx, memberId, role);
  return { ok: true };
});

export const DELETE = route<P>(async (_req, base, { id, memberId }) => {
  const ctx = await contextFor(base, id);
  await removeMember(ctx, memberId);
  return { ok: true };
});
