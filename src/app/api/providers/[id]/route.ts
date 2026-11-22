import { route, parseBody } from "@/lib/api/handler";
import { updateProviderSchema } from "@/lib/contracts";
import * as providers from "@/lib/providers/service";
import { can } from "@/lib/workspaces/permissions";
import { forbidden } from "@/lib/api/errors";

type P = { id: string };

export const GET = route<P>(async (_req, ctx, { id }) => {
  if (!can(ctx.role, "providers.view")) throw forbidden();
  return providers.toDTO(await providers.getRow(ctx, id), ctx);
});

export const PATCH = route<P>(async (req, ctx, { id }) => providers.update(ctx, id, await parseBody(req, updateProviderSchema)));

export const DELETE = route<P>(async (_req, ctx, { id }) => {
  await providers.remove(ctx, id);
  return { ok: true };
});
