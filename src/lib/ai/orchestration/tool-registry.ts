import { z, type ZodType } from "zod";
import { evaluate, CalcError } from "../tools/calculator";
import type { ToolSpec } from "../providers/types";

export type ToolKind = "builtin" | "control";

export type ToolContext = {
  workspaceId: string;
  userId: string;
  locale: string;
  timeZone: string;
  signal: AbortSignal;
};

export type ToolDefinition<I = unknown, O = unknown> = {
  name: string;
  description: string;
  kind: ToolKind;
  input: ZodType<I>;
  output: ZodType<O>;
  /** Tools that change state outside this run always go through the approval engine. */
  requiresApproval: boolean;
  timeoutMs: number;
  /** Shown in the agent builder. */
  label: { fa: string; en: string };
  /** Control tools are handled by the orchestrator, not by `handler`. */
  handler?: (input: I, ctx: ToolContext) => Promise<O>;
};

const calculate: ToolDefinition<{ expression: string }, { result: number }> = {
  name: "calculate",
  description: "Evaluate an arithmetic expression. Supports + - * / % ^, parentheses, and sqrt, abs, round, floor, ceil, sin, cos, tan, log, ln, min, max, pow, pi, e.",
  kind: "builtin",
  input: z.object({ expression: z.string().min(1).max(500) }),
  output: z.object({ result: z.number() }),
  requiresApproval: false,
  timeoutMs: 1_000,
  label: { fa: "ماشین‌حساب", en: "Calculator" },
  async handler({ expression }) {
    try {
      return { result: evaluate(expression) };
    } catch (err) {
      if (err instanceof CalcError) throw new ToolInputError(err.message);
      throw err;
    }
  },
};

const datetime: ToolDefinition<{ timeZone?: string }, { iso: string; timeZone: string; local: string; persian: string }> = {
  name: "get_current_datetime",
  description: "Get the current date and time. Optionally pass an IANA time zone such as Asia/Tehran.",
  kind: "builtin",
  input: z.object({ timeZone: z.string().max(64).optional() }),
  output: z.object({ iso: z.string(), timeZone: z.string(), local: z.string(), persian: z.string() }),
  requiresApproval: false,
  timeoutMs: 1_000,
  label: { fa: "تاریخ و ساعت", en: "Date and time" },
  async handler({ timeZone }, ctx) {
    const tz = timeZone || ctx.timeZone;
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
    } catch {
      throw new ToolInputError(`Unknown time zone: ${tz}`);
    }
    const now = new Date();
    return {
      iso: now.toISOString(),
      timeZone: tz,
      local: new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "long", timeZone: tz }).format(now),
      persian: new Intl.DateTimeFormat("fa-IR-u-ca-persian", { dateStyle: "full", timeStyle: "short", timeZone: tz }).format(now),
    };
  },
};

const delegate: ToolDefinition<{ subagentId: string; taskPrompt: string }, { result: string }> = {
  name: "delegate_to_agent",
  description:
    "Give a self-contained task to one of your permitted subagents and get its answer back. The subagent does not see this conversation, so include every detail it needs in taskPrompt.",
  kind: "control",
  input: z.object({ subagentId: z.string().min(1), taskPrompt: z.string().min(1).max(8000) }),
  output: z.object({ result: z.string() }),
  requiresApproval: false,
  timeoutMs: 300_000,
  label: { fa: "واگذاری به زیرعامل", en: "Delegate to subagent" },
};

const handoff: ToolDefinition<{ targetAgentId: string; summaryOfConversation: string }, { ok: boolean }> = {
  name: "handoff_to_agent",
  description:
    "Transfer this conversation to another agent that is better suited. The target takes over from the next message. Summarise what the user needs so the target can continue.",
  kind: "control",
  input: z.object({ targetAgentId: z.string().min(1), summaryOfConversation: z.string().min(1).max(4000) }),
  output: z.object({ ok: z.boolean() }),
  requiresApproval: false,
  timeoutMs: 10_000,
  label: { fa: "سپردن گفتگو", en: "Hand off conversation" },
};

export class ToolInputError extends Error {}

const TOOLS = new Map<string, ToolDefinition<never, unknown>>(
  [calculate, datetime, delegate, handoff].map((t) => [t.name, t as unknown as ToolDefinition<never, unknown>]),
);

export function getTool(name: string): ToolDefinition<unknown, unknown> | undefined {
  return TOOLS.get(name) as ToolDefinition<unknown, unknown> | undefined;
}

export function listTools() {
  return [...TOOLS.values()].map((t) => ({ name: t.name, kind: t.kind, label: t.label, description: t.description, requiresApproval: t.requiresApproval }));
}

/** Tools a user can toggle on an agent. Control tools are granted through delegation/handoff targets. */
export const SELECTABLE_TOOLS = [...TOOLS.values()].filter((t) => t.kind === "builtin").map((t) => t.name);

export function toToolSpec(def: ToolDefinition<unknown, unknown>, extraDescription?: string): ToolSpec {
  return {
    name: def.name,
    description: extraDescription ? `${def.description}\n${extraDescription}` : def.description,
    parameters: z.toJSONSchema(def.input) as Record<string, unknown>,
  };
}
