import { z } from "zod";
import { route, parseBody } from "@/lib/api/handler";
import { switchWorkspace } from "@/lib/workspaces/service";

export const POST = route(async (req, ctx) => {
  const { workspaceId } = await parseBody(req, z.object({ workspaceId: z.string().min(1) }));
  return switchWorkspace(ctx.userId, workspaceId);
});
