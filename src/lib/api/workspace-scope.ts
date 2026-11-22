import { notFound } from "./errors";
import { getMembership, type WorkspaceContext } from "../workspaces/service";

/** For routes that name a workspace in the URL: membership is checked, never assumed. */
export async function contextFor(base: WorkspaceContext, workspaceId: string): Promise<WorkspaceContext> {
  if (workspaceId === base.workspaceId) return base;
  const role = await getMembership(base.userId, workspaceId);
  if (!role) throw notFound("Workspace");
  return { userId: base.userId, workspaceId, role };
}
