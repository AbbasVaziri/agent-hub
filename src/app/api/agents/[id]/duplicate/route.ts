import { route } from "@/lib/api/handler";
import * as agents from "@/lib/agents/service";

export const POST = route<{ id: string }>(async (_req, ctx, { id }) => Response.json(await agents.duplicate(ctx, id), { status: 201 }));
