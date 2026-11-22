import { route, parseBody } from "@/lib/api/handler";
import { createProviderSchema } from "@/lib/contracts";
import * as providers from "@/lib/providers/service";

export const GET = route(async (_req, ctx) => ({ items: await providers.list(ctx) }));

export const POST = route(async (req, ctx) => {
  const created = await providers.create(ctx, await parseBody(req, createProviderSchema));
  return Response.json(created, { status: 201 });
});
