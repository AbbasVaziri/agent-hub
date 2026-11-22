import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, isNull, gt } from "drizzle-orm";
import { db, schema } from "../db/client";
import { AppError, forbidden, notFound } from "../api/errors";
import { audit } from "../audit";
import { can, canAssignRole, type Role } from "./permissions";

export type WorkspaceContext = {
  userId: string;
  workspaceId: string;
  role: Role;
};

function slugify(name: string): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "workspace";
  return `${base}-${randomBytes(3).toString("hex")}`;
}

export async function createPersonalWorkspace(user: { id: string; name: string }) {
  return createWorkspace(user.id, user.name ? `${user.name}` : "Personal", true);
}

export async function createWorkspace(userId: string, name: string, isPersonal = false) {
  return db().transaction(async (tx) => {
    const [ws] = await tx.insert(schema.workspaces).values({ name, slug: slugify(name), ownerId: userId, isPersonal }).returning();
    await tx.insert(schema.workspaceMembers).values({ workspaceId: ws.id, userId, role: "owner" });
    await tx.update(schema.users).set({ activeWorkspaceId: ws.id }).where(eq(schema.users.id, userId));
    await audit({ workspaceId: ws.id, actorUserId: userId, action: "workspace.created", targetType: "workspace", targetId: ws.id }, tx);
    return ws;
  });
}

export async function listMemberships(userId: string) {
  return db()
    .select({
      id: schema.workspaces.id,
      name: schema.workspaces.name,
      slug: schema.workspaces.slug,
      isPersonal: schema.workspaces.isPersonal,
      role: schema.workspaceMembers.role,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(eq(schema.workspaceMembers.userId, userId))
    .orderBy(asc(schema.workspaces.createdAt));
}

export async function getMembership(userId: string, workspaceId: string): Promise<Role | null> {
  const [row] = await db()
    .select({ role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(and(eq(schema.workspaceMembers.userId, userId), eq(schema.workspaceMembers.workspaceId, workspaceId)));
  return row?.role ?? null;
}

/** The active workspace lives on the user row and is re-validated on every request. */
export async function resolveWorkspaceContext(userId: string): Promise<WorkspaceContext> {
  const [user] = await db().select({ active: schema.users.activeWorkspaceId }).from(schema.users).where(eq(schema.users.id, userId));
  if (user?.active) {
    const role = await getMembership(userId, user.active);
    if (role) return { userId, workspaceId: user.active, role };
  }
  const memberships = await listMemberships(userId);
  const target = memberships[0];
  if (!target) {
    const ws = await createPersonalWorkspace({ id: userId, name: "Personal" });
    return { userId, workspaceId: ws.id, role: "owner" };
  }
  await db().update(schema.users).set({ activeWorkspaceId: target.id }).where(eq(schema.users.id, userId));
  return { userId, workspaceId: target.id, role: target.role };
}

export async function switchWorkspace(userId: string, workspaceId: string) {
  const role = await getMembership(userId, workspaceId);
  if (!role) throw notFound("Workspace");
  await db().update(schema.users).set({ activeWorkspaceId: workspaceId }).where(eq(schema.users.id, userId));
  return { workspaceId, role };
}

export async function updateWorkspace(ctx: WorkspaceContext, input: { name?: string; monthlyBudgetUsd?: number | null }) {
  if (!can(ctx.role, "workspace.update")) throw forbidden();
  const [ws] = await db().update(schema.workspaces).set(input).where(eq(schema.workspaces.id, ctx.workspaceId)).returning();
  await audit({ workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "workspace.updated", metadata: input });
  return ws;
}

export async function getWorkspace(ctx: WorkspaceContext) {
  const [ws] = await db().select().from(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspaceId));
  if (!ws) throw notFound("Workspace");
  return ws;
}

export async function deleteWorkspace(ctx: WorkspaceContext, confirmName: string) {
  if (!can(ctx.role, "workspace.delete")) throw forbidden("Only the owner can delete a workspace");
  const ws = await getWorkspace(ctx);
  if (ws.isPersonal) throw new AppError("CONFLICT", "The personal workspace cannot be deleted. Delete your account instead.");
  if (confirmName !== ws.name) throw new AppError("VALIDATION_ERROR", "Workspace name does not match");
  await db().transaction(async (tx) => {
    await tx.delete(schema.workspaces).where(eq(schema.workspaces.id, ws.id));
    await audit({ workspaceId: null, actorUserId: ctx.userId, action: "workspace.deleted", targetId: ws.id, metadata: { name: ws.name } }, tx);
  });
}

export async function listMembers(ctx: WorkspaceContext) {
  if (!can(ctx.role, "members.view")) throw forbidden();
  return db()
    .select({
      id: schema.workspaceMembers.id,
      userId: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.workspaceMembers.role,
      joinedAt: schema.workspaceMembers.joinedAt,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
    .where(eq(schema.workspaceMembers.workspaceId, ctx.workspaceId))
    .orderBy(asc(schema.workspaceMembers.joinedAt));
}

export async function changeMemberRole(ctx: WorkspaceContext, memberId: string, newRole: Role) {
  const [m] = await db()
    .select()
    .from(schema.workspaceMembers)
    .where(and(eq(schema.workspaceMembers.id, memberId), eq(schema.workspaceMembers.workspaceId, ctx.workspaceId)));
  if (!m) throw notFound("Member");
  if (!canAssignRole(ctx.role, m.role, newRole)) throw forbidden();
  await db().update(schema.workspaceMembers).set({ role: newRole }).where(eq(schema.workspaceMembers.id, memberId));
  await audit({ workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "member.role_changed", targetId: m.userId, metadata: { from: m.role, to: newRole } });
}

export async function removeMember(ctx: WorkspaceContext, memberId: string) {
  const [m] = await db()
    .select()
    .from(schema.workspaceMembers)
    .where(and(eq(schema.workspaceMembers.id, memberId), eq(schema.workspaceMembers.workspaceId, ctx.workspaceId)));
  if (!m) throw notFound("Member");
  const leavingSelf = m.userId === ctx.userId;
  if (m.role === "owner") throw new AppError("CONFLICT", "The owner cannot be removed");
  if (!leavingSelf && !canAssignRole(ctx.role, m.role, m.role)) throw forbidden();
  await db().delete(schema.workspaceMembers).where(eq(schema.workspaceMembers.id, memberId));
  await audit({ workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: leavingSelf ? "member.left" : "member.removed", targetId: m.userId });
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function createInvitation(ctx: WorkspaceContext, email: string, role: Role) {
  if (!canAssignRole(ctx.role, "viewer", role)) throw forbidden();
  const token = randomBytes(24).toString("base64url");
  const [inv] = await db()
    .insert(schema.workspaceInvitations)
    .values({
      workspaceId: ctx.workspaceId,
      email: email.toLowerCase(),
      role,
      tokenHash: hashToken(token),
      invitedByUserId: ctx.userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    })
    .returning();
  await audit({ workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "invitation.created", metadata: { email, role } });
  return { invitation: inv, token };
}

export async function listInvitations(ctx: WorkspaceContext) {
  if (!can(ctx.role, "members.manage")) throw forbidden();
  return db()
    .select({
      id: schema.workspaceInvitations.id,
      email: schema.workspaceInvitations.email,
      role: schema.workspaceInvitations.role,
      expiresAt: schema.workspaceInvitations.expiresAt,
      createdAt: schema.workspaceInvitations.createdAt,
    })
    .from(schema.workspaceInvitations)
    .where(
      and(
        eq(schema.workspaceInvitations.workspaceId, ctx.workspaceId),
        isNull(schema.workspaceInvitations.acceptedAt),
        isNull(schema.workspaceInvitations.revokedAt),
        gt(schema.workspaceInvitations.expiresAt, new Date()),
      ),
    );
}

export async function revokeInvitation(ctx: WorkspaceContext, id: string) {
  if (!can(ctx.role, "members.manage")) throw forbidden();
  const res = await db()
    .update(schema.workspaceInvitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.workspaceInvitations.id, id), eq(schema.workspaceInvitations.workspaceId, ctx.workspaceId)))
    .returning({ id: schema.workspaceInvitations.id });
  if (res.length === 0) throw notFound("Invitation");
}

export async function acceptInvitation(userId: string, userEmail: string, token: string) {
  return db().transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(schema.workspaceInvitations)
      .where(eq(schema.workspaceInvitations.tokenHash, hashToken(token)))
      .for("update");
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) throw new AppError("NOT_FOUND", "Invitation is invalid or expired");
    if (inv.email !== userEmail.toLowerCase()) throw forbidden("This invitation was sent to a different email address");
    await tx
      .insert(schema.workspaceMembers)
      .values({ workspaceId: inv.workspaceId, userId, role: inv.role })
      .onConflictDoNothing();
    await tx.update(schema.workspaceInvitations).set({ acceptedAt: new Date() }).where(eq(schema.workspaceInvitations.id, inv.id));
    await tx.update(schema.users).set({ activeWorkspaceId: inv.workspaceId }).where(eq(schema.users.id, userId));
    await audit({ workspaceId: inv.workspaceId, actorUserId: userId, action: "invitation.accepted" }, tx);
    return inv.workspaceId;
  });
}

/** Account deletion is blocked while the user owns a shared workspace with other members. */
export async function assertCanDeleteAccount(userId: string) {
  const owned = await db().select().from(schema.workspaces).where(eq(schema.workspaces.ownerId, userId));
  for (const ws of owned) {
    const members = await db().select({ id: schema.workspaceMembers.id }).from(schema.workspaceMembers).where(eq(schema.workspaceMembers.workspaceId, ws.id));
    if (!ws.isPersonal && members.length > 1) {
      throw new AppError("CONFLICT", `Transfer or delete the workspace "${ws.name}" before deleting your account`);
    }
  }
  // Owned workspaces with no other members are removed with the account.
  for (const ws of owned) await db().delete(schema.workspaces).where(eq(schema.workspaces.id, ws.id));
}
