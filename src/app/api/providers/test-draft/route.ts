import { route, parseBody } from "@/lib/api/handler";
import { testDraftProviderSchema } from "@/lib/contracts";
import { rateLimit } from "@/lib/security/rate-limit";
import * as providers from "@/lib/providers/service";

export const POST = route(async (req, ctx) => {
  await rateLimit(`provider-test:${ctx.userId}`, 20, 60);
  return providers.testDraft(ctx, await parseBody(req, testDraftProviderSchema));
});
