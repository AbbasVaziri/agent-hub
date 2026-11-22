import { route, parseBody } from "@/lib/api/handler";
import { agentInputSchema } from "@/lib/contracts";
import * as agents from "@/lib/agents/service";

type P = { id: string };

export const GET = route<P>(async (_req, ctx, { id }) => agents.get(ctx, id));
export const PUT = route<P>(async (req, ctx, { id }) => agents.update(ctx, id, await parseBody(req, agentInputSchema)));
export const DELETE = route<P>(async (_req, ctx, { id }) => {
  await agents.remove(ctx, id);
  return { ok: true };
});
