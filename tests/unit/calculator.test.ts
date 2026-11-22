import { describe, expect, it } from "vitest";
import { evaluate } from "@/lib/ai/tools/calculator";

describe("calculator", () => {
  it.each([
    ["2+3*4", 14],
    ["(2+3)*4", 20],
    ["2^3^2", 512],
    ["-3 + 5", 2],
    ["sqrt(16) + abs(-2)", 6],
    ["max(1, 7, 3)", 7],
    ["10 % 4", 2],
    ["۲+۲", 4],
    ["6×7", 42],
    ["1e3 / 4", 250],
  ])("%s = %d", (expr, expected) => expect(evaluate(expr)).toBeCloseTo(expected));

  it.each(["", "2+", "process.exit()", "constructor", "1/0", "(((1)", "2 2", "a".repeat(600), "require('fs')"])("rejects %s", (expr) => {
    expect(() => evaluate(expr)).toThrow();
  });

  it("limits nesting depth", () => {
    expect(() => evaluate("(".repeat(80) + "1" + ")".repeat(80))).toThrow(/deep/);
  });
});
