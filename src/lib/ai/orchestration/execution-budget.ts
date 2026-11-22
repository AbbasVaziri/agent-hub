import { AppError } from "@/lib/api/errors";

export type BudgetLimits = {
  maxIterations: number;
  maxToolCalls: number;
  maxDelegations: number;
  maxOutputTokens: number;
  maxEstimatedCost: number;
  timeoutMs: number;
};

export const PLATFORM_CEILINGS: BudgetLimits = {
  maxIterations: 20,
  maxToolCalls: 40,
  maxDelegations: 5,
  maxOutputTokens: 32_000,
  maxEstimatedCost: 10,
  timeoutMs: 10 * 60_000,
};

export type BudgetUsage = {
  iterations: number;
  toolCalls: number;
  delegations: number;
  outputTokens: number;
  inputTokens: number;
  estimatedCost: number;
};

/** Agent settings can only tighten the platform ceilings, never loosen them. */
export function clampLimits(agent: Partial<BudgetLimits>): BudgetLimits {
  const out = { ...PLATFORM_CEILINGS };
  for (const key of Object.keys(PLATFORM_CEILINGS) as Array<keyof BudgetLimits>) {
    const v = agent[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[key] = Math.min(v, PLATFORM_CEILINGS[key]);
  }
  return out;
}

export class ExecutionBudget {
  readonly usage: BudgetUsage = { iterations: 0, toolCalls: 0, delegations: 0, outputTokens: 0, inputTokens: 0, estimatedCost: 0 };
  private startedAt = Date.now();

  /** Used when the run is paused on something outside the model's control, such as an approval. */
  extendTimeout(ms: number): void {
    this.startedAt += Math.max(0, ms);
  }

  constructor(readonly limits: BudgetLimits) {}

  private fail(what: string): never {
    throw new AppError("LIMIT_EXCEEDED", `Execution limit reached: ${what}`, { limit: what });
  }

  beginIteration(): void {
    if (this.usage.iterations >= this.limits.maxIterations) this.fail("maxIterations");
    this.checkTime();
    this.usage.iterations++;
  }

  beginToolCall(): void {
    if (this.usage.toolCalls >= this.limits.maxToolCalls) this.fail("maxToolCalls");
    this.usage.toolCalls++;
  }

  beginDelegation(): void {
    if (this.usage.delegations >= this.limits.maxDelegations) this.fail("maxDelegations");
    this.usage.delegations++;
  }

  remainingOutputTokens(): number {
    return Math.max(0, this.limits.maxOutputTokens - this.usage.outputTokens);
  }

  record(tokens: { input: number; output: number; cost: number }): void {
    this.usage.inputTokens += tokens.input;
    this.usage.outputTokens += tokens.output;
    this.usage.estimatedCost += tokens.cost;
  }

  checkAfterCall(): void {
    if (this.usage.outputTokens > this.limits.maxOutputTokens) this.fail("maxOutputTokens");
    if (this.usage.estimatedCost > this.limits.maxEstimatedCost) this.fail("maxEstimatedCost");
    this.checkTime();
  }

  checkTime(): void {
    if (Date.now() - this.startedAt > this.limits.timeoutMs) this.fail("timeoutMs");
  }

  remainingMs(): number {
    return Math.max(0, this.limits.timeoutMs - (Date.now() - this.startedAt));
  }
}
