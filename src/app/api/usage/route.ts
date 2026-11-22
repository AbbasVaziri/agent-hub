import { z } from "zod";
import { route, parseQuery } from "@/lib/api/handler";
import { usageSummary } from "@/lib/usage/service";

export const GET = route(async (req, ctx) => {
  const { days } = parseQuery(req, z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }));
  return usageSummary(ctx, days);
});
