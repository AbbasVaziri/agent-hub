import { describe, expect, it } from "vitest";
import { getTool, listTools, SELECTABLE_TOOLS, toToolSpec } from "@/lib/ai/orchestration/tool-registry";

const ctx = { workspaceId: "w", userId: "u", locale: "fa", timeZone: "Asia/Tehran", signal: new AbortController().signal };

describe("tool registry", () => {
  it("exposes the four initial tools, with control tools not user-selectable", () => {
    expect(listTools().map((t) => t.name).sort()).toEqual(["calculate", "delegate_to_agent", "get_current_datetime", "handoff_to_agent"]);
    expect(SELECTABLE_TOOLS.sort()).toEqual(["calculate", "get_current_datetime"]);
  });

  it("produces JSON schema parameters for providers", () => {
    const spec = toToolSpec(getTool("delegate_to_agent")!);
    expect(spec.parameters).toMatchObject({ type: "object", required: ["subagentId", "taskPrompt"] });
  });

  it("validates input with zod before running", () => {
    const calc = getTool("calculate")!;
    expect(calc.input.safeParse({}).success).toBe(false);
    expect(calc.input.safeParse({ expression: "1+1", extra: "ignored" }).success).toBe(true);
  });

  it("runs handlers", async () => {
    expect(await getTool("calculate")!.handler!({ expression: "2*21" }, ctx)).toEqual({ result: 42 });
    const dt = (await getTool("get_current_datetime")!.handler!({}, ctx)) as { timeZone: string; persian: string };
    expect(dt.timeZone).toBe("Asia/Tehran");
    expect(dt.persian.length).toBeGreaterThan(5);
    await expect(getTool("get_current_datetime")!.handler!({ timeZone: "Mars/Base" }, ctx)).rejects.toThrow(/Unknown time zone/);
  });
});
