import { eq } from "drizzle-orm";
import { z } from "zod";
import { route, parseBody } from "@/lib/api/handler";
import { db, schema } from "@/lib/db/client";
import { listMemberships } from "@/lib/workspaces/service";

export const GET = route(async (_req, ctx) => {
  const [user] = await db()
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, locale: schema.users.locale, emailVerified: schema.users.emailVerified })
    .from(schema.users)
    .where(eq(schema.users.id, ctx.userId));
  return { user, workspaceId: ctx.workspaceId, role: ctx.role, workspaces: await listMemberships(ctx.userId) };
});

const patchSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), locale: z.enum(["fa", "en"]).optional() });

export const PATCH = route(async (req, ctx) => {
  const input = await parseBody(req, patchSchema);
  await db().update(schema.users).set(input).where(eq(schema.users.id, ctx.userId));
  return { ok: true };
});
