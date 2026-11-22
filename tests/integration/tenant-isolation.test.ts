import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import * as providers from "@/lib/providers/service";
import * as agents from "@/lib/agents/service";
import * as conversations from "@/lib/conversations/service";
import { contextFor } from "@/lib/api/workspace-scope";
import { resolveWorkspaceContext, switchWorkspace, createWorkspace, listMembers, changeMemberRole } from "@/lib/workspaces/service";
import { createOrAttachRun, cancelRun, getRunForUser } from "@/lib/ai/orchestration/orchestrator";
import { createMockProvider } from "../support/mock-provider";
import { addMember, makeAgent, makeConversation, makeProvider, makeUser, waitForRun } from "../support/fixtures";

const mock = createMockProvider();
let baseUrl: string;
beforeAll(async () => {
  baseUrl = await mock.listen();
});
afterAll(() => mock.close());

describe("cross-tenant isolation", () => {
  it("a user from another workspace cannot read or change any resource", async () => {
    const alice = await makeUser("Alice");
    const bob = await makeUser("Bob");
    const conn = await makeProvider(alice, baseUrl);
    const agent = await makeAgent(alice, { providerConnectionId: conn.id, model: "mock-small" });
    const conv = await makeConversation(alice, agent.id);

    await expect(providers.getRow(bob, conn.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(providers.update(bob, conn.id, { label: "pwned" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(providers.remove(bob, conn.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(agents.get(bob, agent.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(agents.remove(bob, agent.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(conversations.getRow(bob, conv.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(conversations.timeline(bob, conv.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createOrAttachRun(bob, { conversationId: conv.id, content: "hi", clientMessageId: crypto.randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await providers.list(bob)).length).toBe(0);
    expect((await agents.list(bob)).length).toBe(0);
    expect((await conversations.list(bob, { limit: 50 })).items.length).toBe(0);
  });

  it("cannot attach another workspace's agent or provider by id", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const conn = await makeProvider(alice, baseUrl);
    const aliceAgent = await makeAgent(alice, { mode: "subagent" });
    await expect(makeAgent(bob, { providerConnectionId: conn.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(makeAgent(bob, { delegationTargets: [aliceAgent.id] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(conversations.create(bob, { agentId: aliceAgent.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("runs and their events are not reachable across workspaces", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const conn = await makeProvider(alice, baseUrl);
    const agent = await makeAgent(alice, { providerConnectionId: conn.id });
    const conv = await makeConversation(alice, agent.id);
    const { runId } = await createOrAttachRun(alice, { conversationId: conv.id, content: "hello", clientMessageId: crypto.randomUUID() });
    await waitForRun(runId);
    await expect(getRunForUser(bob, runId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(cancelRun(bob, runId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("validates workspace ids taken from the URL and from switch requests", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    await expect(contextFor(bob, alice.workspaceId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(switchWorkspace(bob.userId, alice.workspaceId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // A stale active workspace on the user row is re-validated, not trusted.
    await db().update(schema.users).set({ activeWorkspaceId: alice.workspaceId }).where(eq(schema.users.id, bob.userId));
    const ctx = await resolveWorkspaceContext(bob.userId);
    expect(ctx.workspaceId).toBe(bob.workspaceId);
  });
});

describe("roles inside one workspace", () => {
  it("members cannot see other members' private conversations; shared ones are read-only", async () => {
    const owner = await makeUser();
    const member = await addMember(owner, "member");
    const other = await addMember(owner, "member");
    const agent = await makeAgent(owner);
    const conv = await conversations.create(member, { agentId: agent.id });
    await expect(conversations.getRow(other, conv.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await conversations.list(other, { limit: 10 })).items).toHaveLength(0);
    await conversations.update(member, conv.id, { visibility: "workspace" });
    const shared = await conversations.getRow(other, conv.id);
    expect(shared.id).toBe(conv.id);
    await expect(createOrAttachRun(other, { conversationId: conv.id, content: "x", clientMessageId: crypto.randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Owners can see everything for oversight.
    expect((await conversations.getRow(owner, conv.id)).id).toBe(conv.id);
  });

  it("viewers and members are limited by the permission matrix", async () => {
    const owner = await makeUser();
    const viewer = await addMember(owner, "viewer");
    const member = await addMember(owner, "member");
    await expect(makeAgent(viewer)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(conversations.create(viewer, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(makeProvider(member, baseUrl)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ownersAgent = await makeAgent(owner);
    await expect(agents.remove(member, ownersAgent.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const membersAgent = await makeAgent(member);
    await agents.remove(member, membersAgent.id);
  });

  it("admins cannot demote the owner and members cannot change roles", async () => {
    const owner = await makeUser();
    const admin = await addMember(owner, "admin");
    const member = await addMember(owner, "member");
    const list = await listMembers(owner);
    const ownerRow = list.find((m) => m.userId === owner.userId)!;
    const memberRow = list.find((m) => m.userId === member.userId)!;
    await expect(changeMemberRole(admin, ownerRow.id, "viewer")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(changeMemberRole(member, memberRow.id, "admin")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await changeMemberRole(admin, memberRow.id, "viewer");
  });

  it("creating a workspace makes the creator its owner and switches to it", async () => {
    const u = await makeUser();
    const ws = await createWorkspace(u.userId, "Team");
    const ctx = await resolveWorkspaceContext(u.userId);
    expect(ctx).toMatchObject({ workspaceId: ws.id, role: "owner" });
  });
});
