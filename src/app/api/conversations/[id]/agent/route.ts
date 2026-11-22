import { route, parseBody } from "@/lib/api/handler";
import { switchAgentSchema } from "@/lib/contracts";
import * as conversations from "@/lib/conversations/service";

export const PUT = route<{ id: string }>(async (req, ctx, { id }) => {
  const { agentId } = await parseBody(req, switchAgentSchema);
  return conversations.switchAgent(ctx, id, agentId);
});
