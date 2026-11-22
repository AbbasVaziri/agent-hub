export const ROLES = ["owner", "admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  "workspace.update",
  "workspace.delete",
  "members.view",
  "members.manage",
  "providers.view",
  "providers.manage",
  "agents.view",
  "agents.create",
  "agents.edit_any",
  "agents.edit_own",
  "agents.delete_any",
  "conversations.create",
  "conversations.view_all",
  "conversations.view_shared",
  "approvals.review",
  "usage.view",
  "audit.view",
] as const;
export type Action = (typeof ACTIONS)[number];

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  owner: new Set(ACTIONS),
  admin: new Set<Action>([
    "workspace.update",
    "members.view",
    "members.manage",
    "providers.view",
    "providers.manage",
    "agents.view",
    "agents.create",
    "agents.edit_any",
    "agents.edit_own",
    "agents.delete_any",
    "conversations.create",
    "conversations.view_all",
    "conversations.view_shared",
    "approvals.review",
    "usage.view",
    "audit.view",
  ]),
  member: new Set<Action>([
    "members.view",
    "providers.view",
    "agents.view",
    "agents.create",
    "agents.edit_own",
    "conversations.create",
    "conversations.view_shared",
    "approvals.review",
  ]),
  viewer: new Set<Action>(["members.view", "agents.view", "conversations.view_shared"]),
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[role].has(action);
}

/** Admins cannot touch owners, and nobody can grant a role above their own. */
export function canAssignRole(actor: Role, target: Role, newRole: Role): boolean {
  if (!can(actor, "members.manage")) return false;
  // Ownership transfer is a separate flow; the owner row is never edited here.
  if (target === "owner" || newRole === "owner") return false;
  return rank(newRole) <= rank(actor) && rank(target) <= rank(actor);
}

function rank(r: Role): number {
  return { viewer: 0, member: 1, admin: 2, owner: 3 }[r];
}

export type ConversationAccess = {
  createdByUserId: string;
  visibility: "private" | "workspace";
};

/**
 * Conversations are private to their creator unless shared with the workspace.
 * Admins and owners can see every conversation for oversight.
 */
export function canViewConversation(role: Role, userId: string, c: ConversationAccess): boolean {
  if (c.createdByUserId === userId) return true;
  if (can(role, "conversations.view_all")) return true;
  return c.visibility === "workspace" && can(role, "conversations.view_shared");
}

/** Only the creator writes into a conversation; shared viewers read. */
export function canWriteConversation(role: Role, userId: string, c: ConversationAccess): boolean {
  return c.createdByUserId === userId && can(role, "conversations.create");
}

export function canEditAgent(role: Role, userId: string, agent: { createdByUserId: string }): boolean {
  if (can(role, "agents.edit_any")) return true;
  return can(role, "agents.edit_own") && agent.createdByUserId === userId;
}
