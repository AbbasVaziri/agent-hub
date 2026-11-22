import { route } from "@/lib/api/handler";
import { rateLimit } from "@/lib/security/rate-limit";
import * as providers from "@/lib/providers/service";

export const POST = route<{ id: string }>(async (_req, ctx, { id }) => {
  await rateLimit(`provider-test:${ctx.userId}`, 20, 60);
  return providers.test(ctx, id);
});
