import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { createPersonalWorkspace, type WorkspaceContext } from "@/lib/workspaces/service";
import * as providers from "@/lib/providers/service";
import * as agents from "@/lib/agents/service";
import * as conversations from "@/lib/conversations/service";
import { agentInputSchema, type AgentInput } from "@/lib/contracts";
import type { Role } from "@/lib/workspaces/permissions";
import { MOCK_API_KEY } from "./mock-provider";

let n = 0;

export async function makeUser(name = "Test User"): Promise<WorkspaceContext & { email: string }> {
  n++;
  const email = `user${n}-${crypto.randomUUID().slice(0, 6)}@example.com`;
  const [user] = await db().insert(schema.users).values({ name, email, emailVerified: true }).returning();
  const ws = await createPersonalWorkspace({ id: user.id, name });
  return { userId: user.id, workspaceId: ws.id, role: "owner", email };
}

export async function addMember(owner: WorkspaceContext, role: Role): Promise<WorkspaceContext> {
  const u = await makeUser(`${role} member`);
  await db().insert(schema.workspaceMembers).values({ workspaceId: owner.workspaceId, userId: u.userId, role });
  await db().update(schema.users).set({ activeWorkspaceId: owner.workspaceId }).where(eq(schema.users.id, u.userId));
  return { userId: u.userId, workspaceId: owner.workspaceId, role };
}

export async function makeProvider(ctx: WorkspaceContext, baseUrl: string) {
  return providers.create(ctx, { label: "Mock", providerType: "openai_compatible", baseUrl, apiKey: MOCK_API_KEY, defaultModel: "mock-small" });
}

export async function makeAgent(ctx: WorkspaceContext, overrides: Partial<AgentInput> = {}) {
  return agents.create(ctx, agentInputSchema.parse({ name: "Agent", ...overrides }));
}

export async function makeConversation(ctx: WorkspaceContext, agentId: string) {
  return conversations.create(ctx, { agentId });
}

export async function waitForRun(runId: string, timeoutMs = 15_000) {
  const start = Date.now();
  for (;;) {
    const [r] = await db().select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
    if (r && ["completed", "failed", "cancelled"].includes(r.status)) return r;
    if (Date.now() - start > timeoutMs) throw new Error(`Run ${runId} did not finish (status ${r?.status})`);
    await new Promise((res) => setTimeout(res, 50));
  }
}

export async function waitFor<T>(fn: () => Promise<T | null | undefined>, timeoutMs = 10_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((res) => setTimeout(res, 50));
  }
}

export async function messagesOf(conversationId: string) {
  const rows = await db().select().from(schema.messages).where(eq(schema.messages.conversationId, conversationId));
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}
