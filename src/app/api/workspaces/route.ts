import { route, parseBody } from "@/lib/api/handler";
import { workspaceCreateSchema } from "@/lib/contracts";
import { createWorkspace, listMemberships } from "@/lib/workspaces/service";
import { rateLimit } from "@/lib/security/rate-limit";

export const GET = route(async (_req, ctx) => ({ items: await listMemberships(ctx.userId), activeWorkspaceId: ctx.workspaceId }));

export const POST = route(async (req, ctx) => {
  const { name } = await parseBody(req, workspaceCreateSchema);
  await rateLimit(`ws-create:${ctx.userId}`, 10, 3600);
  const ws = await createWorkspace(ctx.userId, name);
  return Response.json({ id: ws.id, name: ws.name, slug: ws.slug }, { status: 201 });
});
