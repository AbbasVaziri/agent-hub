import { route, parseBody } from "@/lib/api/handler";
import { agentInputSchema } from "@/lib/contracts";
import * as agents from "@/lib/agents/service";

export const GET = route(async (_req, ctx) => ({ items: await agents.list(ctx) }));

export const POST = route(async (req, ctx) => Response.json(await agents.create(ctx, await parseBody(req, agentInputSchema)), { status: 201 }));
