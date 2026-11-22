import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { AppError } from "@/lib/api/errors";
import type { AgentRow } from "@/lib/agents/service";
import { connectionConfig } from "@/lib/providers/service";
import { estimateCost, fallbackPricing } from "@/lib/usage/pricing";
import { log } from "@/lib/logger";
import { getAdapter } from "../providers/registry";
import { ProviderError, type ChatMessage, type ToolCallRequest, type ToolSpec } from "../providers/types";
import { assembleSystemPrompt, type PeerAgent } from "../chat/chat-context";
import { clampLimits, ExecutionBudget, PLATFORM_CEILINGS } from "./execution-budget";
import { getTool, toToolSpec, ToolInputError, type ToolDefinition } from "./tool-registry";
import { awaitApproval } from "./approval-engine";
import { DelegationRejected, finishDelegation, prepareDelegation } from "./delegation";
import { HandoffRejected, performHandoff } from "./handoff";
import type { RunEmitter } from "./run-events";

export class RunFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RunFailure";
  }
}

export type RunScope = {
  workspaceId: string;
  conversationId: string;
  userId: string;
  rootRunId: string;
  locale: "fa" | "en";
  timeZone: string;
};

export type AgentTurnParams = {
  scope: RunScope;
  runId: string;
  agent: AgentRow;
  executionContext: "primary" | "subagent";
  depth: number;
  messages: ChatMessage[];
  emitter: RunEmitter;
  signal: AbortSignal;
  budget: ExecutionBudget;
  /** Root runs stream text to the user; subagent text only returns to the parent. */
  onText?: (text: string) => void;
  /** Conversation-level model choice; applies to the lead agent only. */
  modelOverride?: { providerConnectionId: string; model: string | null } | null;
};

export type AgentTurnResult = {
  text: string;
  handoff?: { target: AgentRow; summary: string; handoffId: string };
};

export function limitsFor(agent: AgentRow) {
  return clampLimits({
    maxIterations: agent.maxIterations,
    maxToolCalls: agent.maxToolCalls,
    maxOutputTokens: agent.maxOutputTokens,
    maxEstimatedCost: agent.maxEstimatedCost,
    timeoutMs: agent.timeoutMs,
    maxDelegations: PLATFORM_CEILINGS.maxDelegations,
  });
}

async function peers(workspaceId: string, ids: string[]): Promise<PeerAgent[]> {
  if (!ids.length) return [];
  const rows = await db().select().from(schema.agentProfiles).where(eq(schema.agentProfiles.workspaceId, workspaceId));
  return rows.filter((r) => ids.includes(r.id) && r.isActive).map((r) => ({ id: r.id, name: r.name, description: r.description, role: r.role }));
}

/** Which tools this agent may call in this execution context. Server-side, never from the prompt. */
export function permittedToolNames(agent: AgentRow, executionContext: "primary" | "subagent"): string[] {
  const names = [...agent.allowedTools];
  if (executionContext === "primary" && agent.mode !== "subagent") {
    if (agent.delegationTargets.length) names.push("delegate_to_agent");
    if (agent.handoffTargets.length) names.push("handoff_to_agent");
  }
  return names.filter((n) => !!getTool(n));
}

export async function buildSystemPrompt(scope: RunScope, agent: AgentRow, executionContext: "primary" | "subagent", handoffNote?: { fromAgentName: string | null; summary: string }) {
  const tools = permittedToolNames(agent, executionContext);
  return assembleSystemPrompt(agent, {
    executionContext,
    toolNames: tools,
    delegationTargets: executionContext === "primary" ? await peers(scope.workspaceId, agent.delegationTargets) : [],
    handoffTargets: executionContext === "primary" ? await peers(scope.workspaceId, agent.handoffTargets) : [],
    limits: limitsFor(agent),
    preferredLanguage: scope.locale,
    handoffNote,
  });
}

async function resolveProvider(scope: RunScope, agent: AgentRow, override?: AgentTurnParams["modelOverride"]) {
  const connectionId = override?.providerConnectionId ?? agent.providerConnectionId;
  if (!connectionId) throw new RunFailure("PROVIDER_NOT_CONFIGURED", "Agent has no provider connection");
  const [row] = await db()
    .select()
    .from(schema.providerConnections)
    .where(and(eq(schema.providerConnections.id, connectionId), eq(schema.providerConnections.workspaceId, scope.workspaceId)));
  if (!row) throw new RunFailure("PROVIDER_NOT_CONFIGURED", "Provider connection was removed");
  const model = override ? override.model || row.defaultModel : agent.model || row.defaultModel;
  if (!model) throw new RunFailure("PROVIDER_NOT_CONFIGURED", "No model selected");
  return { row, model, cfg: await connectionConfig(row) };
}

function mapProviderError(err: ProviderError): RunFailure {
  if (err.kind === "auth") return new RunFailure("PROVIDER_AUTH_ERROR", err.message);
  if (err.kind === "rate_limit") return new RunFailure("PROVIDER_RATE_LIMITED", err.message);
  return new RunFailure("PROVIDER_ERROR", err.message);
}

async function withTimeout<T>(ms: number, signal: AbortSignal, fn: (s: AbortSignal) => Promise<T>): Promise<T> {
  const s = AbortSignal.any([signal, AbortSignal.timeout(ms)]);
  return fn(s);
}

type ToolOutcome = { content: string; handoff?: AgentTurnResult["handoff"] };

export async function runAgentTurns(p: AgentTurnParams): Promise<AgentTurnResult> {
  const { scope, agent, emitter, budget, signal } = p;
  const provider = await resolveProvider(scope, agent, p.executionContext === "primary" ? p.modelOverride : null);
  const adapter = getAdapter(provider.row.providerType);
  const pricing = provider.row.pricing ?? fallbackPricing(provider.row.providerType);
  const caps = adapter.capabilities(provider.model);
  const toolNames = caps.toolCalling ? permittedToolNames(agent, p.executionContext) : [];
  const toolSpecs: ToolSpec[] = toolNames.map((n) => toToolSpec(getTool(n)!));
  const messages = [...p.messages];
  let finalText = "";

  for (;;) {
    budget.beginIteration();
    if (signal.aborted) throw signal.reason ?? new Error("aborted");
    const started = Date.now();
    let text = "";
    const calls: ToolCallRequest[] = [];
    let usage = { input: 0, output: 0 };
    let finish: string = "stop";

    try {
      const stream = adapter.streamChat(provider.cfg, {
        model: provider.model,
        messages,
        tools: toolSpecs.length ? toolSpecs : undefined,
        maxOutputTokens: Math.max(64, Math.min(agent.maxOutputTokens, budget.remainingOutputTokens())),
        signal: AbortSignal.any([signal, AbortSignal.timeout(Math.max(1000, budget.remainingMs()))]),
      });
      for await (const ev of stream) {
        if (ev.type === "text") {
          text += ev.text;
          p.onText?.(ev.text);
        } else if (ev.type === "reasoning") {
          // Only provider-supplied, user-visible reasoning text is forwarded, and only for the lead agent.
          if (p.executionContext === "primary") emitter.emit("reasoning", { text: ev.text });
        } else if (ev.type === "tool_call") calls.push(ev.call);
        else if (ev.type === "usage") usage = { input: ev.inputTokens, output: ev.outputTokens };
        else if (ev.type === "finish") finish = ev.reason;
      }
    } catch (err) {
      if (signal.aborted) throw signal.reason ?? err;
      if (err instanceof ProviderError) throw mapProviderError(err);
      throw err;
    } finally {
      const cost = estimateCost(pricing, usage.input, usage.output);
      budget.record({ input: usage.input, output: usage.output, cost });
      if (usage.input || usage.output) {
        await db().insert(schema.usageRecords).values({
          workspaceId: scope.workspaceId,
          userId: scope.userId,
          runId: p.runId,
          agentId: agent.id,
          providerConnectionId: provider.row.id,
          providerType: provider.row.providerType,
          model: provider.model,
          inputTokens: usage.input,
          outputTokens: usage.output,
          estimatedCost: cost,
          costIsEstimate: true,
          durationMs: Date.now() - started,
        });
      }
    }
    budget.checkAfterCall();
    finalText += text;

    if (calls.length === 0 || finish === "length") return { text: finalText };

    messages.push({ role: "assistant", content: text, toolCalls: calls });
    let handoff: AgentTurnResult["handoff"];
    for (const call of calls) {
      const outcome: ToolOutcome = handoff
        ? { content: JSON.stringify({ error: "Conversation was already handed off in this turn" }) }
        : await executeToolCall(p, call, toolNames);
      if (outcome.handoff) handoff = outcome.handoff;
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: outcome.content });
    }
    if (handoff) return { text: finalText, handoff };
    if (text) finalText += "\n\n";
  }
}

async function executeToolCall(p: AgentTurnParams, call: ToolCallRequest, permitted: string[]): Promise<ToolOutcome> {
  const { scope, emitter, budget } = p;
  budget.beginToolCall();
  const def = getTool(call.name);
  const visible = p.executionContext === "primary";

  // Idempotency: a retried run never executes the same provider tool call twice.
  const [existing] = await db()
    .select()
    .from(schema.toolExecutions)
    .where(and(eq(schema.toolExecutions.runId, p.runId), eq(schema.toolExecutions.toolCallId, call.id)));
  if (existing && (existing.status === "completed" || existing.status === "failed" || existing.status === "rejected")) {
    return { content: JSON.stringify(existing.output ?? { error: "Tool already executed" }) };
  }

  const fail = async (execId: string | null, message: string, status: "failed" | "rejected" = "failed") => {
    const output = { error: message };
    if (execId) await db().update(schema.toolExecutions).set({ status, output }).where(eq(schema.toolExecutions.id, execId));
    if (visible) emitter.emit("tool_result", { toolCallId: call.id, name: call.name, status });
    return { content: JSON.stringify(output) };
  };

  let parsedArgs: unknown;
  try {
    parsedArgs = JSON.parse(call.arguments || "{}");
  } catch {
    parsedArgs = undefined;
  }

  const [exec] = await db()
    .insert(schema.toolExecutions)
    .values({
      workspaceId: scope.workspaceId,
      runId: p.runId,
      toolCallId: call.id,
      toolName: call.name.slice(0, 64),
      input: (parsedArgs ?? { raw: call.arguments.slice(0, 2000) }) as object,
      status: "running",
    })
    .onConflictDoNothing()
    .returning();
  const execId = exec?.id ?? existing?.id ?? null;
  if (visible) emitter.emit("tool_call", { toolCallId: call.id, name: call.name, status: "started", agentId: p.agent.id });

  if (!def || !permitted.includes(call.name)) return fail(execId, `Tool '${call.name}' is not available to this agent`);
  const input = def.input.safeParse(parsedArgs);
  if (!input.success) return fail(execId, `Invalid arguments: ${input.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);

  if (execId && (def.requiresApproval || p.agent.requireApproval)) {
    await db().update(schema.toolExecutions).set({ status: "pending_approval" }).where(eq(schema.toolExecutions.id, execId));
    if (visible) emitter.emit("tool_call", { toolCallId: call.id, name: call.name, status: "waiting_for_approval", agentId: p.agent.id });
    const decision = await awaitApproval({
      workspaceId: scope.workspaceId,
      runId: p.runId,
      rootRunId: scope.rootRunId,
      toolExecutionId: execId,
      toolCallId: call.id,
      toolName: call.name,
      agentId: p.agent.id,
      emitter,
      signal: p.signal,
      budget,
    });
    if (decision !== "approved") return fail(execId, decision === "expired" ? "The approval request expired" : "The user rejected this action", "rejected");
    await db().update(schema.toolExecutions).set({ status: "running" }).where(eq(schema.toolExecutions.id, execId));
  }

  const started = Date.now();
  try {
    let output: unknown;
    let handoff: AgentTurnResult["handoff"];
    if (def.name === "delegate_to_agent") output = await runDelegation(p, input.data as { subagentId: string; taskPrompt: string });
    else if (def.name === "handoff_to_agent") {
      const args = input.data as { targetAgentId: string; summaryOfConversation: string };
      const res = await performHandoff({
        workspaceId: scope.workspaceId,
        conversationId: scope.conversationId,
        runId: scope.rootRunId,
        source: p.agent,
        targetAgentId: args.targetAgentId,
        summary: args.summaryOfConversation,
        executionContext: p.executionContext,
      });
      handoff = { target: res.target, summary: args.summaryOfConversation, handoffId: res.handoffId };
      output = { ok: true, message: `Conversation handed to ${res.target.name}` };
    } else {
      output = await withTimeout(def.timeoutMs, p.signal, (s) =>
        (def as ToolDefinition<unknown, unknown>).handler!(input.data, {
          workspaceId: scope.workspaceId,
          userId: scope.userId,
          locale: scope.locale,
          timeZone: scope.timeZone,
          signal: s,
        }),
      );
    }
    const durationMs = Date.now() - started;
    if (execId) await db().update(schema.toolExecutions).set({ status: "completed", output: output as object, durationMs }).where(eq(schema.toolExecutions.id, execId));
    if (visible) emitter.emit("tool_result", { toolCallId: call.id, name: call.name, status: "completed", durationMs });
    return { content: JSON.stringify(output), handoff };
  } catch (err) {
    if (p.signal.aborted) throw p.signal.reason ?? err;
    if (err instanceof ToolInputError || err instanceof HandoffRejected || err instanceof DelegationRejected) return fail(execId, err.message);
    if (err instanceof AppError && err.code === "LIMIT_EXCEEDED") throw err;
    if (err instanceof RunFailure) return fail(execId, `Subagent failed: ${err.code}`);
    log.warn("Tool execution failed", { tool: call.name, err });
    return fail(execId, "The tool failed to run");
  }
}

async function runDelegation(p: AgentTurnParams, args: { subagentId: string; taskPrompt: string }): Promise<{ result: string }> {
  const { scope, emitter, budget } = p;
  const prep = await prepareDelegation({
    workspaceId: scope.workspaceId,
    conversationId: scope.conversationId,
    userId: scope.userId,
    parentRunId: p.runId,
    source: p.agent,
    subagentId: args.subagentId,
    taskPrompt: args.taskPrompt,
    depth: p.depth,
  });
  budget.beginDelegation();
  emitter.emit("delegation", { delegationId: prep.delegation.id, agentId: prep.target.id, status: "running" });

  const childLimits = limitsFor(prep.target);
  // A subagent can never outlive or outspend its parent.
  childLimits.timeoutMs = Math.min(childLimits.timeoutMs, budget.remainingMs());
  childLimits.maxEstimatedCost = Math.min(childLimits.maxEstimatedCost, Math.max(0, budget.limits.maxEstimatedCost - budget.usage.estimatedCost));
  const childBudget = new ExecutionBudget(childLimits);
  let status: "completed" | "failed" | "cancelled" = "failed";
  try {
    const system = await buildSystemPrompt(scope, prep.target, "subagent");
    const result = await runAgentTurns({
      scope,
      runId: prep.childRun.id,
      agent: prep.target,
      executionContext: "subagent",
      depth: p.depth + 1,
      messages: [
        { role: "system", content: system },
        { role: "user", content: args.taskPrompt },
      ],
      emitter,
      signal: p.signal,
      budget: childBudget,
    });
    status = "completed";
    return { result: result.text || "(The subagent returned no text.)" };
  } catch (err) {
    status = p.signal.aborted ? "cancelled" : "failed";
    throw err instanceof RunFailure || (err instanceof AppError && err.code === "LIMIT_EXCEEDED") ? new RunFailure("SUBAGENT_FAILED", (err as Error).message) : err;
  } finally {
    // Child spend counts against the parent's cost cap; tokens stay on the child run.
    budget.record({ input: 0, output: 0, cost: childBudget.usage.estimatedCost });
    await db()
      .update(schema.agentRuns)
      .set({
        status,
        finishedAt: new Date(),
        iterations: childBudget.usage.iterations,
        toolCalls: childBudget.usage.toolCalls,
        inputTokens: childBudget.usage.inputTokens,
        outputTokens: childBudget.usage.outputTokens,
        estimatedCost: childBudget.usage.estimatedCost,
      })
      .where(eq(schema.agentRuns.id, prep.childRun.id));
    await finishDelegation(prep.delegation.id, status);
    emitter.emit("delegation", { delegationId: prep.delegation.id, agentId: prep.target.id, status });
  }
}
