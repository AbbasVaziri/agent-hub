import { z } from "zod";
import { route, parseBody } from "@/lib/api/handler";
import { contextFor } from "@/lib/api/workspace-scope";
import { workspaceUpdateSchema } from "@/lib/contracts";
import { deleteWorkspace, getWorkspace, updateWorkspace } from "@/lib/workspaces/service";

type P = { id: string };

export const GET = route<P>(async (_req, base, { id }) => {
  const ctx = await contextFor(base, id);
  const ws = await getWorkspace(ctx);
  return { id: ws.id, name: ws.name, slug: ws.slug, isPersonal: ws.isPersonal, monthlyBudgetUsd: ws.monthlyBudgetUsd, role: ctx.role };
});

export const PATCH = route<P>(async (req, base, { id }) => {
  const ctx = await contextFor(base, id);
  const ws = await updateWorkspace(ctx, await parseBody(req, workspaceUpdateSchema));
  return { id: ws.id, name: ws.name, monthlyBudgetUsd: ws.monthlyBudgetUsd };
});

export const DELETE = route<P>(async (req, base, { id }) => {
  const ctx = await contextFor(base, id);
  const { confirmName } = await parseBody(req, z.object({ confirmName: z.string() }));
  await deleteWorkspace(ctx, confirmName);
  return { ok: true };
});
