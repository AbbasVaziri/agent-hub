import { z } from "zod";
import { route, parseBody, parseQuery } from "@/lib/api/handler";
import { createConversationSchema } from "@/lib/contracts";
import * as conversations from "@/lib/conversations/service";

const query = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  status: z.enum(["active", "archived"]).optional(),
});

export const GET = route(async (req, ctx) => conversations.list(ctx, parseQuery(req, query)));

export const POST = route(async (req, ctx) => Response.json(await conversations.create(ctx, await parseBody(req, createConversationSchema)), { status: 201 }));
