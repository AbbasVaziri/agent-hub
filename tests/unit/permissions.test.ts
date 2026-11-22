import { describe, expect, it } from "vitest";
import { can, canAssignRole, canEditAgent, canViewConversation, canWriteConversation } from "@/lib/workspaces/permissions";

describe("permission matrix", () => {
  it("matches the role table", () => {
    expect(can("owner", "workspace.delete")).toBe(true);
    expect(can("admin", "workspace.delete")).toBe(false);
    expect(can("admin", "providers.manage")).toBe(true);
    expect(can("member", "providers.manage")).toBe(false);
    expect(can("member", "agents.create")).toBe(true);
    expect(can("viewer", "agents.create")).toBe(false);
    expect(can("viewer", "conversations.create")).toBe(false);
  });

  it("scopes conversations to their creator unless shared", () => {
    const priv = { createdByUserId: "u1", visibility: "private" as const };
    const shared = { createdByUserId: "u1", visibility: "workspace" as const };
    expect(canViewConversation("member", "u2", priv)).toBe(false);
    expect(canViewConversation("member", "u2", shared)).toBe(true);
    expect(canViewConversation("viewer", "u2", shared)).toBe(true);
    expect(canViewConversation("admin", "u2", priv)).toBe(true);
    expect(canWriteConversation("admin", "u2", shared)).toBe(false);
    expect(canWriteConversation("member", "u1", priv)).toBe(true);
  });

  it("limits agent edits for members to their own agents", () => {
    expect(canEditAgent("member", "u1", { createdByUserId: "u1" })).toBe(true);
    expect(canEditAgent("member", "u1", { createdByUserId: "u2" })).toBe(false);
    expect(canEditAgent("admin", "u1", { createdByUserId: "u2" })).toBe(true);
    expect(canEditAgent("viewer", "u1", { createdByUserId: "u1" })).toBe(false);
  });

  it("never lets anyone assign owner or touch the owner row", () => {
    expect(canAssignRole("owner", "member", "owner")).toBe(false);
    expect(canAssignRole("admin", "owner", "member")).toBe(false);
    expect(canAssignRole("admin", "member", "admin")).toBe(true);
    expect(canAssignRole("member", "viewer", "member")).toBe(false);
  });
});
