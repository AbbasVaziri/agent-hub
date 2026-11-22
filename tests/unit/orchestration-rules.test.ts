import { describe, expect, it } from "vitest";
import { checkHandoffRules, HandoffRejected, MAX_AUTOMATIC_HANDOFFS } from "@/lib/ai/orchestration/handoff";
import { checkDelegationRules, DelegationRejected } from "@/lib/ai/orchestration/delegation";

const ws = "ws1";
const source = { id: "A", handoffTargets: ["B", "S"], delegationTargets: ["S", "B"], mode: "primary" as const };
const B = { id: "B", mode: "all" as const, isActive: true, workspaceId: ws };
const S = { id: "S", mode: "subagent" as const, isActive: true, workspaceId: ws };
const conv = { activeAgentId: "A", handoffCount: 0, lastHandoffFromAgentId: null };

describe("handoff rules", () => {
  const ok = { source, target: B, workspaceId: ws, executionContext: "primary" as const, conversation: conv };
  it("allows a permitted target", () => expect(() => checkHandoffRules(ok)).not.toThrow());
  it("rejects subagent-only destinations", () => expect(() => checkHandoffRules({ ...ok, target: S })).toThrow(HandoffRejected));
  it("rejects targets outside the permission list", () =>
    expect(() => checkHandoffRules({ ...ok, target: { ...B, id: "C" } })).toThrow(/not allowed/));
  it("rejects other workspaces", () => expect(() => checkHandoffRules({ ...ok, target: { ...B, workspaceId: "other" } })).toThrow(/not found/));
  it("rejects handoff from a subagent context", () => expect(() => checkHandoffRules({ ...ok, executionContext: "subagent" })).toThrow(/Subagents/));
  it(`rejects handoff number ${MAX_AUTOMATIC_HANDOFFS + 1}`, () =>
    expect(() => checkHandoffRules({ ...ok, conversation: { ...conv, handoffCount: MAX_AUTOMATIC_HANDOFFS } })).toThrow(/limit/));
  it("rejects bouncing straight back", () =>
    expect(() => checkHandoffRules({ ...ok, conversation: { ...conv, lastHandoffFromAgentId: "B" } })).toThrow(/straight back/));
  it("rejects a stale source that no longer leads", () =>
    expect(() => checkHandoffRules({ ...ok, conversation: { ...conv, activeAgentId: "B" } })).toThrow(/no longer leads/));
  it("rejects inactive targets", () => expect(() => checkHandoffRules({ ...ok, target: { ...B, isActive: false } })).toThrow(/turned off/));
});

describe("delegation rules", () => {
  const ok = { source, target: S, workspaceId: ws, depth: 0 };
  it("allows a permitted subagent", () => expect(() => checkDelegationRules(ok)).not.toThrow());
  it("allows an 'all' agent as subagent", () => expect(() => checkDelegationRules({ ...ok, target: B })).not.toThrow());
  it("rejects nested delegation", () => expect(() => checkDelegationRules({ ...ok, depth: 1 })).toThrow(DelegationRejected));
  it("rejects primary-only targets", () => expect(() => checkDelegationRules({ ...ok, target: { ...B, mode: "primary" } })).toThrow(/cannot run as a subagent/));
  it("rejects unlisted targets", () => expect(() => checkDelegationRules({ ...ok, target: { ...S, id: "Z" } })).toThrow(/not allowed/));
  it("rejects cross-workspace targets", () => expect(() => checkDelegationRules({ ...ok, target: { ...S, workspaceId: "x" } })).toThrow(/not found/));
});
