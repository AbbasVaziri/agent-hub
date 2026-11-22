import { route, parseBody } from "@/lib/api/handler";
import { updateConversationSchema } from "@/lib/contracts";
import * as conversations from "@/lib/conversations/service";

type P = { id: string };

export const GET = route<P>(async (_req, ctx, { id }) => conversations.toDTO(await conversations.getRow(ctx, id), ctx));
export const PATCH = route<P>(async (req, ctx, { id }) => conversations.update(ctx, id, await parseBody(req, updateConversationSchema)));
export const DELETE = route<P>(async (_req, ctx, { id }) => {
  await conversations.remove(ctx, id);
  return { ok: true };
});
