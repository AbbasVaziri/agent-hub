import { describe, expect, it } from "vitest";
import { clampLimits, ExecutionBudget, PLATFORM_CEILINGS } from "@/lib/ai/orchestration/execution-budget";

describe("execution budget", () => {
  it("agent settings can tighten but never exceed platform ceilings", () => {
    const l = clampLimits({ maxIterations: 999, maxToolCalls: 2, maxEstimatedCost: 50 });
    expect(l.maxIterations).toBe(PLATFORM_CEILINGS.maxIterations);
    expect(l.maxToolCalls).toBe(2);
    expect(l.maxEstimatedCost).toBe(PLATFORM_CEILINGS.maxEstimatedCost);
  });

  it("stops at max iterations and tool calls", () => {
    const b = new ExecutionBudget(clampLimits({ maxIterations: 2, maxToolCalls: 1 }));
    b.beginIteration();
    b.beginIteration();
    expect(() => b.beginIteration()).toThrow(/maxIterations/);
    b.beginToolCall();
    expect(() => b.beginToolCall()).toThrow(/maxToolCalls/);
  });

  it("stops when cost or output tokens exceed the limit", () => {
    const b = new ExecutionBudget(clampLimits({ maxEstimatedCost: 0.01, maxOutputTokens: 100 }));
    b.record({ input: 10, output: 50, cost: 0.005 });
    b.checkAfterCall();
    b.record({ input: 10, output: 10, cost: 0.02 });
    expect(() => b.checkAfterCall()).toThrow(/maxEstimatedCost/);
    const t = new ExecutionBudget(clampLimits({ maxOutputTokens: 100 }));
    t.record({ input: 0, output: 101, cost: 0 });
    expect(() => t.checkAfterCall()).toThrow(/maxOutputTokens/);
  });

  it("enforces the run timeout and allows approval waits to extend it", () => {
    const b = new ExecutionBudget(clampLimits({ timeoutMs: 5000 }));
    (b as unknown as { startedAt: number }).startedAt = Date.now() - 6000;
    expect(() => b.checkTime()).toThrow(/timeoutMs/);
    b.extendTimeout(2000);
    expect(() => b.checkTime()).not.toThrow();
  });
});
