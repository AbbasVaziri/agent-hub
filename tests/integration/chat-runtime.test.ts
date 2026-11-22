import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import * as conversations from "@/lib/conversations/service";
import * as agents from "@/lib/agents/service";
import { agentInputSchema } from "@/lib/contracts";
import { cancelRun, createOrAttachRun } from "@/lib/ai/orchestration/orchestrator";
import { reviewApproval } from "@/lib/ai/orchestration/approval-engine";
import { performHandoff } from "@/lib/ai/orchestration/handoff";
import { replayEvents } from "@/lib/ai/orchestration/run-events";
import { createMockProvider } from "../support/mock-provider";
import { addMember, makeAgent, makeConversation, makeProvider, makeUser, messagesOf, waitFor, waitForRun } from "../support/fixtures";

const mock = createMockProvider();
let baseUrl: string;
beforeAll(async () => {
  baseUrl = await mock.listen();
});
afterAll(() => mock.close());

async function setup(agentOverrides = {}) {
  const ctx = await makeUser();
  const conn = await makeProvider(ctx, baseUrl);
  const agent = await makeAgent(ctx, { name: "Lead", providerConnectionId: conn.id, model: "mock-small", ...agentOverrides });
  const conv = await makeConversation(ctx, agent.id);
  return { ctx, conn, agent, conv };
}

const send = (ctx: Parameters<typeof createOrAttachRun>[0], conversationId: string, content: string, clientMessageId = crypto.randomUUID()) =>
  createOrAttachRun(ctx, { conversationId, content, clientMessageId });

describe("streaming chat run", () => {
  it("persists the user message, streams the reply, records usage and a durable event log", async () => {
    const { ctx, conv } = await setup();
    const { runId } = await send(ctx, conv.id, "سلام، hello");
    const run = await waitForRun(runId);
    expect(run.status).toBe("completed");
    const msgs = await messagesOf(conv.id);
    expect(msgs.map((m) => [m.role, m.status])).toEqual([
      ["user", "completed"],
      ["assistant", "completed"],
    ]);
    expect(msgs[1].content).toBe("Echo: سلام، hello");
    const events = await replayEvents(runId, 0);
    expect(events[0].type).toBe("run");
    expect(events.filter((e) => e.type === "chunk").map((e) => (e.data as { text: string }).text).join("")).toBe("Echo: سلام، hello");
    expect(events.at(-1)).toMatchObject({ type: "done", data: { status: "completed" } });
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    const usage = await db().select().from(schema.usageRecords).where(eq(schema.usageRecords.runId, runId));
    expect(usage[0]).toMatchObject({ inputTokens: 50, outputTokens: 20, costIsEstimate: true });
    expect((await conversations.getRow(ctx, conv.id)).title).toBe("سلام، hello");
  });

  it("is idempotent: a retried request with the same clientMessageId returns the same run", async () => {
    const { ctx, conv } = await setup();
    const id = crypto.randomUUID();
    const [a, b] = await Promise.all([send(ctx, conv.id, "dup", id), send(ctx, conv.id, "dup", id)]);
    expect(a.runId).toBe(b.runId);
    await waitForRun(a.runId);
    expect((await messagesOf(conv.id)).filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("rejects a second concurrent reply in the same conversation", async () => {
    const { ctx, conv } = await setup();
    const { runId } = await send(ctx, conv.id, "[slow]");
    await expect(send(ctx, conv.id, "again")).rejects.toMatchObject({ code: "CONFLICT" });
    await cancelRun(ctx, runId);
    await waitForRun(runId);
  });

  it("executes a permitted tool and feeds the result back", async () => {
    const { ctx, conv } = await setup({ allowedTools: ["calculate"] });
    const { runId } = await send(ctx, conv.id, "[calc:6*7]");
    expect((await waitForRun(runId)).status).toBe("completed");
    const [exec] = await db().select().from(schema.toolExecutions).where(eq(schema.toolExecutions.runId, runId));
    expect(exec).toMatchObject({ toolName: "calculate", status: "completed", output: { result: 42 } });
    expect((await messagesOf(conv.id))[1].content).toContain('"result":42');
  });

  it("refuses a tool the agent was not granted", async () => {
    const { ctx, conv, agent } = await setup({ allowedTools: [] });
    // Grant at the provider level only: the mock asks for calculate even though the agent lacks it.
    void agent;
    const { runId } = await send(ctx, conv.id, "[calc:1+1]");
    await waitForRun(runId);
    const [exec] = await db().select().from(schema.toolExecutions).where(eq(schema.toolExecutions.runId, runId));
    expect(exec.status).toBe("failed");
    expect(exec.output).toMatchObject({ error: expect.stringContaining("not available") });
  });

  it("stops a user-cancelled run and keeps the partial reply", async () => {
    const { ctx, conv } = await setup();
    const { runId } = await send(ctx, conv.id, "[slow]");
    await waitFor(async () => (await messagesOf(conv.id))[1]?.content.length > 0 || (await replayEvents(runId, 0)).some((e) => e.type === "chunk"));
    await cancelRun(ctx, runId);
    const run = await waitForRun(runId);
    expect(run.status).toBe("cancelled");
    const reply = (await messagesOf(conv.id))[1];
    expect(reply.status).toBe("cancelled");
    expect(reply.content.length).toBeGreaterThan(0);
    expect(reply.content).not.toContain("word59");
  });

  it("marks provider failures as failed with a stable error code", async () => {
    const { ctx, conv } = await setup();
    const { runId } = await send(ctx, conv.id, "[fail]");
    const run = await waitForRun(runId);
    expect(run).toMatchObject({ status: "failed", errorCode: "PROVIDER_ERROR" });
    const events = await replayEvents(runId, 0);
    expect(events.find((e) => e.type === "error")?.data).toMatchObject({ code: "PROVIDER_ERROR" });
    expect(JSON.stringify(events)).not.toContain("mock-test-key");
  });

  it("enforces execution limits on the server", async () => {
    const { ctx, conv } = await setup({ allowedTools: ["calculate"], maxIterations: 1 });
    const { runId } = await send(ctx, conv.id, "[calc:1+1]");
    expect(await waitForRun(runId)).toMatchObject({ status: "failed", errorCode: "LIMIT_EXCEEDED" });
  });

  it("blocks new runs once the monthly budget is used", async () => {
    const { ctx, conv } = await setup();
    await db().update(schema.workspaces).set({ monthlyBudgetUsd: 0 }).where(eq(schema.workspaces.id, ctx.workspaceId));
    await expect(send(ctx, conv.id, "hi")).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
  });

  it("retry replaces a failed reply instead of adding another user message", async () => {
    const { ctx, conv } = await setup();
    const first = await send(ctx, conv.id, "[fail] then ok");
    await waitForRun(first.runId);
    const userMsg = (await messagesOf(conv.id))[0];
    // The mock fails on [fail]; switch content via a new message would differ, so retry reuses the same user message.
    const retry = await createOrAttachRun(ctx, { conversationId: conv.id, content: userMsg.content, clientMessageId: crypto.randomUUID(), retryOfMessageId: userMsg.id });
    await waitForRun(retry.runId);
    const msgs = await messagesOf(conv.id);
    expect(msgs.filter((m) => m.role === "user")).toHaveLength(1);
    expect(msgs.filter((m) => m.role === "assistant")).toHaveLength(1);
  });
});

describe("approvals", () => {
  it("waits for a person, then runs the tool after approval", async () => {
    const { ctx, conv } = await setup({ allowedTools: ["calculate"], requireApproval: true });
    const { runId } = await send(ctx, conv.id, "[calc:2+2]");
    const approval = await waitFor(async () => (await db().select().from(schema.approvalRequests).where(eq(schema.approvalRequests.runId, runId)))[0]);
    expect((await db().select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId)))[0].status).toBe("waiting_for_approval");
    await reviewApproval(ctx, approval.id, "approved");
    expect((await waitForRun(runId)).status).toBe("completed");
    const [exec] = await db().select().from(schema.toolExecutions).where(eq(schema.toolExecutions.runId, runId));
    expect(exec.status).toBe("completed");
    await expect(reviewApproval(ctx, approval.id, "rejected")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a rejected tool never executes, and outsiders cannot decide", async () => {
    const { ctx, conv } = await setup({ allowedTools: ["calculate"], requireApproval: true });
    const outsider = await makeUser();
    const viewer = await addMember(ctx, "viewer");
    const { runId } = await send(ctx, conv.id, "[calc:2+2]");
    const approval = await waitFor(async () => (await db().select().from(schema.approvalRequests).where(eq(schema.approvalRequests.runId, runId)))[0]);
    await expect(reviewApproval(outsider, approval.id, "approved")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(reviewApproval(viewer, approval.id, "approved")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await reviewApproval(ctx, approval.id, "rejected");
    await waitForRun(runId);
    const [exec] = await db().select().from(schema.toolExecutions).where(eq(schema.toolExecutions.runId, runId));
    expect(exec).toMatchObject({ status: "rejected", output: { error: "The user rejected this action" } });
  });
});

describe("delegation", () => {
  it("runs a permitted subagent in an isolated context and returns its answer as a tool result", async () => {
    const ctx = await makeUser();
    const conn = await makeProvider(ctx, baseUrl);
    const sub = await makeAgent(ctx, { name: "Researcher", mode: "subagent", providerConnectionId: conn.id });
    const lead = await makeAgent(ctx, { name: "Lead", providerConnectionId: conn.id, delegationTargets: [sub.id] });
    const conv = await makeConversation(ctx, lead.id);
    const { runId } = await send(ctx, conv.id, "[delegate] summarise the report");
    expect((await waitForRun(runId)).status).toBe("completed");
    const [d] = await db().select().from(schema.agentDelegations).where(eq(schema.agentDelegations.parentRunId, runId));
    expect(d).toMatchObject({ targetAgentId: sub.id, status: "completed", taskPrompt: "summarise the report" });
    const [child] = await db().select().from(schema.agentRuns).where(eq(schema.agentRuns.id, d.childRunId!));
    expect(child).toMatchObject({ parentRunId: runId, status: "completed", agentId: sub.id });
    const reply = (await messagesOf(conv.id))[1].content;
    expect(reply).toContain("Subagent answer for: summarise the report");
    const childUsage = await db().select().from(schema.usageRecords).where(eq(schema.usageRecords.runId, child.id));
    expect(childUsage).toHaveLength(1);
  });

  it("rejects subagents as conversation leads and subagents with targets", async () => {
    const ctx = await makeUser();
    const sub = await makeAgent(ctx, { mode: "subagent" });
    await expect(conversations.create(ctx, { agentId: sub.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const other = await makeAgent(ctx, { mode: "all" });
    await expect(makeAgent(ctx, { mode: "subagent", delegationTargets: [other.id] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(makeAgent(ctx, { delegationTargets: [(await makeAgent(ctx, { mode: "primary" })).id] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("handoff", () => {
  async function pair() {
    const ctx = await makeUser();
    const conn = await makeProvider(ctx, baseUrl);
    const b = await makeAgent(ctx, { name: "Specialist", providerConnectionId: conn.id, mode: "all" });
    const a = await makeAgent(ctx, { name: "Front desk", providerConnectionId: conn.id, handoffTargets: [b.id] });
    const conv = await makeConversation(ctx, a.id);
    return { ctx, conn, a, b, conv };
  }

  it("moves the conversation to the target, records history and lets the target reply", async () => {
    const { ctx, a, b, conv } = await pair();
    const { runId } = await send(ctx, conv.id, "[handoff] I need a specialist");
    expect((await waitForRun(runId)).status).toBe("completed");
    const c = await conversations.getRow(ctx, conv.id);
    expect(c).toMatchObject({ activeAgentId: b.id, handoffCount: 1, lastHandoffFromAgentId: a.id });
    const [h] = await db().select().from(schema.agentHandoffs).where(eq(schema.agentHandoffs.conversationId, conv.id));
    expect(h).toMatchObject({ sourceAgentId: a.id, targetAgentId: b.id, kind: "automatic" });
    const replies = (await messagesOf(conv.id)).filter((m) => m.role === "assistant");
    expect(replies.at(-1)).toMatchObject({ agentId: b.id, content: "I have taken over this conversation." });
    expect((await replayEvents(runId, 0)).some((e) => e.type === "handoff")).toBe(true);
  });

  it("serialises concurrent handoffs so only one wins", async () => {
    const { ctx, a, b, conv } = await pair();
    const aRow = (await agents.getRow(ctx.workspaceId, a.id))!;
    const attempt = () =>
      performHandoff({ workspaceId: ctx.workspaceId, conversationId: conv.id, runId: "r", source: aRow, targetAgentId: b.id, summary: "s", executionContext: "primary" }).then(
        () => "ok",
        (e: Error) => e.message,
      );
    const results = await Promise.all([attempt(), attempt(), attempt()]);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect((await conversations.getRow(ctx, conv.id)).handoffCount).toBe(1);
  });

  it("rejects the fourth automatic handoff; manual switches do not count", async () => {
    const { ctx, a, b, conv } = await pair();
    await db().update(schema.conversations).set({ handoffCount: 3 }).where(eq(schema.conversations.id, conv.id));
    const aRow = (await agents.getRow(ctx.workspaceId, a.id))!;
    await expect(
      performHandoff({ workspaceId: ctx.workspaceId, conversationId: conv.id, runId: "r", source: aRow, targetAgentId: b.id, summary: "s", executionContext: "primary" }),
    ).rejects.toThrow(/limit/);
    await conversations.switchAgent(ctx, conv.id, b.id);
    const c = await conversations.getRow(ctx, conv.id);
    expect(c).toMatchObject({ activeAgentId: b.id, handoffCount: 3 });
    const manual = await db().select().from(schema.agentHandoffs).where(and(eq(schema.agentHandoffs.conversationId, conv.id), eq(schema.agentHandoffs.kind, "manual")));
    expect(manual).toHaveLength(1);
  });

  it("deleting a target agent removes it from other agents' permissions", async () => {
    const { ctx, a, b } = await pair();
    await agents.remove(ctx, b.id);
    expect((await agents.getRow(ctx.workspaceId, a.id))!.handoffTargets).toEqual([]);
    expect(agentInputSchema.parse({ name: "x" }).handoffTargets).toEqual([]);
  });
});
