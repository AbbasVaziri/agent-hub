import { route } from "@/lib/api/handler";
import { rateLimit } from "@/lib/security/rate-limit";
import { forbidden } from "@/lib/api/errors";
import { can } from "@/lib/workspaces/permissions";
import { getAdapter } from "@/lib/ai/providers/registry";
import * as providers from "@/lib/providers/service";

export const GET = route<{ id: string }>(async (_req, ctx, { id }) => {
  if (!can(ctx.role, "providers.view")) throw forbidden();
  const row = await providers.getRow(ctx, id);
  const adapter = getAdapter(row.providerType);
  return { items: row.models.map((m) => ({ ...m, capabilities: adapter.capabilities(m.id) })), defaultModel: row.defaultModel };
});

/** Re-runs discovery against the provider and stores the result. */
export const POST = route<{ id: string }>(async (_req, ctx, { id }) => {
  await rateLimit(`provider-test:${ctx.userId}`, 20, 60);
  return providers.refreshModels(ctx, id);
});
