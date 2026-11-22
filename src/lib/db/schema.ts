import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 14, scale: 6, mode: "number" }).notNull().default(0);

/* Identity. Table and column names follow better-auth's model fields. */

export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  avatarUrl: text("avatar_url"),
  locale: text("locale").notNull().default("fa"),
  activeWorkspaceId: text("active_workspace_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: id(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId)],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_accounts_user_idx").on(t.userId)],
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_verifications_identifier_idx").on(t.identifier)],
);

/* Tenancy */

export const workspaceRole = pgEnum("workspace_role", ["owner", "admin", "member", "viewer"]);

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  isPersonal: boolean("is_personal").notNull().default(false),
  monthlyBudgetUsd: numeric("monthly_budget_usd", { precision: 12, scale: 2, mode: "number" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRole("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("workspace_members_ws_user_uq").on(t.workspaceId, t.userId), index("workspace_members_user_idx").on(t.userId)],
);

export const workspaceInvitations = pgTable(
  "workspace_invitations",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: workspaceRole("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("workspace_invitations_ws_idx").on(t.workspaceId)],
);

/* Providers */

export const providerType = pgEnum("provider_type", ["openai", "anthropic", "openrouter", "ollama", "openai_compatible"]);
export const testStatus = pgEnum("provider_test_status", ["untested", "ok", "failed"]);

export type StoredModel = { id: string; label?: string; contextWindow?: number; manual?: boolean };

export const providerConnections = pgTable(
  "provider_connections",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    providerType: providerType("provider_type").notNull(),
    baseUrl: text("base_url"),
    apiKeyEncrypted: text("api_key_encrypted"),
    apiKeyLast4: text("api_key_last4"),
    encryptionKeyVersion: integer("encryption_key_version"),
    defaultModel: text("default_model"),
    models: jsonb("models").$type<StoredModel[]>().notNull().default([]),
    /** USD per million tokens, entered by the user. Used only for cost estimates and budgets. */
    pricing: jsonb("pricing").$type<{ inputPerMTok: number; outputPerMTok: number } | null>(),
    lastTestStatus: testStatus("last_test_status").notNull().default("untested"),
    lastTestError: text("last_test_error"),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("provider_connections_ws_idx").on(t.workspaceId), uniqueIndex("provider_connections_ws_id_uq").on(t.workspaceId, t.id)],
);

/* Agents */

export const agentMode = pgEnum("agent_mode", ["primary", "subagent", "all"]);

export const agentProfiles = pgTable(
  "agent_profiles",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    role: text("role").notNull().default(""),
    personality: text("personality").notNull().default(""),
    instructions: text("instructions").notNull().default(""),
    tone: text("tone").notNull().default("neutral"),
    avatar: text("avatar").notNull().default("firoozeh"),
    mode: agentMode("mode").notNull().default("primary"),
    providerConnectionId: text("provider_connection_id").references(() => providerConnections.id, { onDelete: "set null" }),
    model: text("model"),
    allowedTools: jsonb("allowed_tools").$type<string[]>().notNull().default([]),
    delegationTargets: jsonb("delegation_targets").$type<string[]>().notNull().default([]),
    handoffTargets: jsonb("handoff_targets").$type<string[]>().notNull().default([]),
    requireApproval: boolean("require_approval").notNull().default(false),
    maxIterations: integer("max_iterations").notNull().default(8),
    maxToolCalls: integer("max_tool_calls").notNull().default(10),
    maxOutputTokens: integer("max_output_tokens").notNull().default(4000),
    maxEstimatedCost: numeric("max_estimated_cost", { precision: 10, scale: 4, mode: "number" }).notNull().default(1),
    timeoutMs: integer("timeout_ms").notNull().default(120_000),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("agent_profiles_ws_idx").on(t.workspaceId), uniqueIndex("agent_profiles_ws_id_uq").on(t.workspaceId, t.id)],
);

/* Conversations */

export const conversationStatus = pgEnum("conversation_status", ["active", "archived"]);
export const conversationVisibility = pgEnum("conversation_visibility", ["private", "workspace"]);

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    activeAgentId: text("active_agent_id").references(() => agentProfiles.id, { onDelete: "set null" }),
    providerConnectionId: text("provider_connection_id").references(() => providerConnections.id, { onDelete: "set null" }),
    model: text("model"),
    handoffCount: integer("handoff_count").notNull().default(0),
    lastHandoffFromAgentId: text("last_handoff_from_agent_id"),
    status: conversationStatus("status").notNull().default("active"),
    visibility: conversationVisibility("visibility").notNull().default("private"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("conversations_ws_user_updated_idx").on(t.workspaceId, t.createdByUserId, t.updatedAt)],
);

export const messageRole = pgEnum("message_role", ["user", "assistant", "system"]);
export const messageStatus = pgEnum("message_status", ["pending", "streaming", "completed", "failed", "cancelled"]);

export type MessagePart = { type: "text"; text: string };

export const messages = pgTable(
  "messages",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    runId: text("run_id"),
    agentId: text("agent_id").references(() => agentProfiles.id, { onDelete: "set null" }),
    role: messageRole("role").notNull(),
    content: text("content").notNull().default(""),
    parts: jsonb("parts").$type<MessagePart[]>(),
    status: messageStatus("status").notNull().default("completed"),
    clientMessageId: text("client_message_id"),
    errorCode: text("error_code"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("messages_conversation_created_idx").on(t.conversationId, t.createdAt),
    uniqueIndex("messages_client_id_uq").on(t.conversationId, t.clientMessageId),
  ],
);

/* Runtime */

export const runStatus = pgEnum("run_status", ["queued", "running", "waiting_for_approval", "completed", "failed", "cancelled"]);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    agentId: text("agent_id").references(() => agentProfiles.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    parentRunId: text("parent_run_id"),
    providerConnectionId: text("provider_connection_id"),
    model: text("model"),
    status: runStatus("status").notNull().default("queued"),
    idempotencyKey: text("idempotency_key"),
    assistantMessageId: text("assistant_message_id"),
    iterations: integer("iterations").notNull().default(0),
    toolCalls: integer("tool_calls").notNull().default(0),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    estimatedCost: money("estimated_cost"),
    createdAt: createdAt(),
  },
  (t) => [
    index("agent_runs_conversation_idx").on(t.conversationId, t.createdAt),
    index("agent_runs_ws_status_idx").on(t.workspaceId, t.status),
    uniqueIndex("agent_runs_idempotency_uq").on(t.workspaceId, t.idempotencyKey),
  ],
);

/** Durable event log for a root run. Streams replay from here after a reconnect. */
export const runEvents = pgTable(
  "run_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    data: jsonb("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("run_events_run_seq_uq").on(t.runId, t.seq)],
);

export const toolStatus = pgEnum("tool_status", ["pending_approval", "running", "completed", "failed", "rejected"]);

export const toolExecutions = pgTable(
  "tool_executions",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    toolCallId: text("tool_call_id").notNull(),
    toolName: text("tool_name").notNull(),
    input: jsonb("input"),
    output: jsonb("output"),
    status: toolStatus("status").notNull(),
    durationMs: integer("duration_ms"),
    approvalRequestId: text("approval_request_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tool_executions_run_call_uq").on(t.runId, t.toolCallId)],
);

export const delegationStatus = pgEnum("delegation_status", ["running", "completed", "failed", "cancelled"]);

export const agentDelegations = pgTable("agent_delegations", {
  id: id(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  parentRunId: text("parent_run_id")
    .notNull()
    .references(() => agentRuns.id, { onDelete: "cascade" }),
  childRunId: text("child_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
  sourceAgentId: text("source_agent_id"),
  targetAgentId: text("target_agent_id"),
  taskPrompt: text("task_prompt").notNull(),
  status: delegationStatus("status").notNull().default("running"),
  createdAt: createdAt(),
});

export const handoffKind = pgEnum("handoff_kind", ["automatic", "manual"]);

export const agentHandoffs = pgTable(
  "agent_handoffs",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    sourceAgentId: text("source_agent_id"),
    targetAgentId: text("target_agent_id").notNull(),
    kind: handoffKind("kind").notNull(),
    summary: text("summary").notNull().default(""),
    byUserId: text("by_user_id"),
    runId: text("run_id"),
    createdAt: createdAt(),
  },
  (t) => [index("agent_handoffs_conversation_idx").on(t.conversationId, t.createdAt)],
);

export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected", "expired"]);

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    toolExecutionId: text("tool_execution_id"),
    requestedByAgentId: text("requested_by_agent_id"),
    requestedAction: text("requested_action").notNull(),
    status: approvalStatus("status").notNull().default("pending"),
    reviewedByUserId: text("reviewed_by_user_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("approval_requests_run_idx").on(t.runId)],
);

export const usageRecords = pgTable(
  "usage_records",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    runId: text("run_id"),
    agentId: text("agent_id"),
    providerConnectionId: text("provider_connection_id"),
    providerType: text("provider_type"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    estimatedCost: money("estimated_cost"),
    costIsEstimate: boolean("cost_is_estimate").notNull().default(true),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("usage_records_ws_created_idx").on(t.workspaceId, t.createdAt)],
);

/* Platform */

export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_ws_created_idx").on(t.workspaceId, t.createdAt)],
);

/** Only written when no SMTP transport is configured (development and tests). */
export const emailOutbox = pgTable("email_outbox", {
  id: id(),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
});
