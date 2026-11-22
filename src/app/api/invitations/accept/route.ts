import { z } from "zod";
import { route, parseBody } from "@/lib/api/handler";
import { acceptInvitation } from "@/lib/workspaces/service";

export const POST = route(async (req, ctx) => {
  const { token } = await parseBody(req, z.object({ token: z.string().min(10).max(100) }));
  return { workspaceId: await acceptInvitation(ctx.userId, ctx.email, token) };
});
