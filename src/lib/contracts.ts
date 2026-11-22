/**
 * Request schemas and response shapes shared by route handlers and the client.
 * Keep this file free of server-only imports.
 */
import { z } from "zod";

export const providerTypeSchema = z.enum(["openai", "anthropic", "openrouter", "ollama", "openai_compatible"]);
export const roleSchema = z.enum(["owner", "admin", "member", "viewer"]);
export const agentModeSchema = z.enum(["primary", "subagent", "all"]);
export const SEAL_COLORS = ["firoozeh", "lapis", "saffron", "pomegranate", "olive", "slate"] as const;
export const sealColorSchema = z.enum(SEAL_COLORS);
export const TONES = ["neutral", "friendly", "formal", "concise", "detailed"] as const;

const modelId = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[\w.:/@+-]+$/, "Model id may only contain letters, digits and . : / @ + - _");

export const createProviderSchema = z.object({
  label: z.string().trim().min(1).max(80),
  providerType: providerTypeSchema,
  baseUrl: z.string().trim().url().max(500).nullish(),
  apiKey: z.string().trim().min(1).max(500).nullish(),
  defaultModel: modelId.nullish(),
  manualModels: z.array(modelId).max(50).optional(),
  pricing: z.object({ inputPerMTok: z.number().min(0).max(1000), outputPerMTok: z.number().min(0).max(1000) }).nullish(),
});
export type CreateProviderInput = z.infer<typeof createProviderSchema>;

export const updateProviderSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  baseUrl: z.string().trim().url().max(500).nullish(),
  /** Omit to keep the stored key; send null to clear it. */
  apiKey: z.string().trim().min(1).max(500).nullish(),
  defaultModel: modelId.nullish(),
  manualModels: z.array(modelId).max(50).optional(),
  pricing: z.object({ inputPerMTok: z.number().min(0).max(1000), outputPerMTok: z.number().min(0).max(1000) }).nullish(),
});

export const testDraftProviderSchema = createProviderSchema.pick({ providerType: true, baseUrl: true, apiKey: true });

export type ProviderDTO = {
  id: string;
  label: string;
  providerType: z.infer<typeof providerTypeSchema>;
  baseUrl: string | null;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  defaultModel: string | null;
  pricing: { inputPerMTok: number; outputPerMTok: number } | null;
  models: Array<{ id: string; label?: string; contextWindow?: number; manual?: boolean }>;
  lastTestStatus: "untested" | "ok" | "failed";
  lastTestError: string | null;
  lastTestedAt: string | null;
  canManage: boolean;
};

const limits = {
  maxIterations: z.number().int().min(1).max(20),
  maxToolCalls: z.number().int().min(0).max(40),
  maxOutputTokens: z.number().int().min(64).max(32000),
  maxEstimatedCost: z.number().min(0).max(10),
  timeoutMs: z.number().int().min(5_000).max(600_000),
};

export const agentInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).default(""),
  role: z.string().trim().max(80).default(""),
  personality: z.string().trim().max(500).default(""),
  instructions: z.string().max(8000).default(""),
  tone: z.enum(TONES).default("neutral"),
  avatar: sealColorSchema.default("firoozeh"),
  mode: agentModeSchema.default("primary"),
  providerConnectionId: z.string().nullish(),
  model: modelId.nullish(),
  allowedTools: z.array(z.string().max(64)).max(20).default([]),
  delegationTargets: z.array(z.string()).max(20).default([]),
  handoffTargets: z.array(z.string()).max(20).default([]),
  requireApproval: z.boolean().default(false),
  maxIterations: limits.maxIterations.default(8),
  maxToolCalls: limits.maxToolCalls.default(10),
  maxOutputTokens: limits.maxOutputTokens.default(4000),
  maxEstimatedCost: limits.maxEstimatedCost.default(1),
  timeoutMs: limits.timeoutMs.default(120_000),
  isActive: z.boolean().default(true),
});
export type AgentInput = z.infer<typeof agentInputSchema>;

export type AgentDTO = AgentInput & { id: string; createdByUserId: string | null; canEdit: boolean; updatedAt: string };

export const createConversationSchema = z.object({
  agentId: z.string().nullish(),
  title: z.string().trim().max(120).optional(),
});
export const updateConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  visibility: z.enum(["private", "workspace"]).optional(),
  status: z.enum(["active", "archived"]).optional(),
  /** Overrides the lead agent's model for this conversation. Both null to clear. */
  providerConnectionId: z.string().nullable().optional(),
  model: modelId.nullable().optional(),
});
export const switchAgentSchema = z.object({ agentId: z.string().min(1) });

export type ConversationDTO = {
  id: string;
  title: string;
  activeAgentId: string | null;
  providerConnectionId: string | null;
  model: string | null;
  handoffCount: number;
  visibility: "private" | "workspace";
  status: "active" | "archived";
  createdByUserId: string;
  canWrite: boolean;
  updatedAt: string;
};

export type MessageDTO = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  agentId: string | null;
  runId: string | null;
  status: "pending" | "streaming" | "completed" | "failed" | "cancelled";
  errorCode: string | null;
  createdAt: string;
};

export type TimelineItem =
  | { kind: "message"; at: string; message: MessageDTO }
  | { kind: "handoff"; at: string; id: string; runId: string | null; fromAgentId: string | null; toAgentId: string; summary: string; mode: "automatic" | "manual" }
  | { kind: "tool"; at: string; id: string; runId: string; toolName: string; status: string; durationMs: number | null }
  | { kind: "approval"; at: string; id: string; runId: string; action: string; status: string };

export const chatStreamSchema = z.object({
  conversationId: z.string().min(1),
  content: z.string().trim().min(1).max(20_000),
  /** Client-generated id; a retried request with the same id never creates a second message or run. */
  clientMessageId: z.string().min(8).max(64),
  /** Re-run the assistant reply for an existing user message instead of posting a new one. */
  retryOfMessageId: z.string().optional(),
});
export type ChatStreamInput = z.infer<typeof chatStreamSchema>;

export const inviteSchema = z.object({ email: z.string().trim().email(), role: roleSchema.exclude(["owner"]) });
export const memberRoleSchema = z.object({ role: roleSchema.exclude(["owner"]) });
export const workspaceCreateSchema = z.object({ name: z.string().trim().min(1).max(60) });
export const workspaceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  monthlyBudgetUsd: z.number().min(0).max(100_000).nullable().optional(),
});

export type ApiError = { error: { code: string; message: string; details?: unknown } };
