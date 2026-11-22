import { z } from "zod";
import { route, parseQuery } from "@/lib/api/handler";
import { auditLog } from "@/lib/usage/service";

export const GET = route(async (req, ctx) => {
  const { limit } = parseQuery(req, z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }));
  return { items: await auditLog(ctx, limit) };
});
