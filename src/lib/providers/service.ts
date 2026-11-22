import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { AppError, forbidden, notFound } from "../api/errors";
import { audit } from "../audit";
import { env } from "../env";
import { appKeyRing, decryptSecret, encryptSecret, needsRotation } from "../security/crypto";
import { OutboundBlockedError, validateOutboundUrl } from "../security/ssrf";
import { getAdapter } from "../ai/providers/registry";
import { ProviderError, type ConnectionConfig, type ModelInfo, type ProviderType } from "../ai/providers/types";
import { can } from "../workspaces/permissions";
import type { WorkspaceContext } from "../workspaces/service";
import type { CreateProviderInput, ProviderDTO } from "../contracts";
import type { StoredModel } from "../db/schema";

type Row = typeof schema.providerConnections.$inferSelect;

export function outboundPolicy() {
  return { allowPrivate: env().ALLOW_PRIVATE_PROVIDER_HOSTS };
}

export function toDTO(row: Row, ctx: WorkspaceContext): ProviderDTO {
  return {
    id: row.id,
    label: row.label,
    providerType: row.providerType,
    baseUrl: row.baseUrl,
    hasApiKey: !!row.apiKeyEncrypted,
    apiKeyHint: row.apiKeyLast4 ? `••••${row.apiKeyLast4}` : null,
    defaultModel: row.defaultModel,
    pricing: row.pricing ?? null,
    models: row.models,
    lastTestStatus: row.lastTestStatus,
    lastTestError: row.lastTestError,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    canManage: can(ctx.role, "providers.manage"),
  };
}

function validateShape(type: ProviderType, baseUrl: string | null | undefined, apiKey: string | null | undefined, hasStoredKey: boolean) {
  const adapter = getAdapter(type);
  if (adapter.requiresBaseUrl && !baseUrl) throw new AppError("VALIDATION_ERROR", "Base URL is required for this provider type");
  if (adapter.requiresApiKey && !apiKey && !hasStoredKey) throw new AppError("VALIDATION_ERROR", "API key is required for this provider type");
  if (baseUrl) validateOutboundUrl(baseUrl, outboundPolicy());
}

const aadFor = (workspaceId: string, connectionId: string) => `${workspaceId}:${connectionId}`;

async function seal(apiKey: string, workspaceId: string, connectionId: string) {
  const ring = await appKeyRing();
  const sealed = encryptSecret(apiKey, ring, aadFor(workspaceId, connectionId));
  return { apiKeyEncrypted: sealed.ciphertext, encryptionKeyVersion: sealed.keyVersion, apiKeyLast4: apiKey.slice(-4) };
}

export async function list(ctx: WorkspaceContext) {
  if (!can(ctx.role, "providers.view")) throw forbidden();
  const rows = await db()
    .select()
    .from(schema.providerConnections)
    .where(eq(schema.providerConnections.workspaceId, ctx.workspaceId))
    .orderBy(desc(schema.providerConnections.createdAt));
  return rows.map((r) => toDTO(r, ctx));
}

export async function getRow(ctx: WorkspaceContext, id: string): Promise<Row> {
  const [row] = await db()
    .select()
    .from(schema.providerConnections)
    .where(and(eq(schema.providerConnections.id, id), eq(schema.providerConnections.workspaceId, ctx.workspaceId)));
  if (!row) throw notFound("Provider connection");
  return row;
}

export async function create(ctx: WorkspaceContext, input: CreateProviderInput) {
  if (!can(ctx.role, "providers.manage")) throw forbidden();
  validateShape(input.providerType, input.baseUrl, input.apiKey, false);
  const id = crypto.randomUUID();
  const secret = input.apiKey ? await seal(input.apiKey, ctx.workspaceId, id) : {};
  const models: StoredModel[] = (input.manualModels ?? []).map((m) => ({ id: m, manual: true }));
  const [row] = await db()
    .insert(schema.providerConnections)
    .values({
      id,
      workspaceId: ctx.workspaceId,
      createdByUserId: ctx.userId,
      label: input.label,
      providerType: input.providerType,
      baseUrl: input.baseUrl ?? null,
      defaultModel: input.defaultModel ?? null,
      pricing: input.pricing ?? null,
      models,
      ...secret,
    })
    .returning();
  await audit({ workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "provider.created", targetType: "provider", targetId: id, metadata: { type: input.providerType } });
  return toDTO(row, ctx);
}

export async function update(
  ctx: WorkspaceContext,
  id: string,
  input: {
    label?: string;
    baseUrl?: string | null;
    apiKey?: string | null;
    defaultModel?: string | null;
    manualModels?: string[];
    pricing?: { inputPerMTok: number; outputPerMTok: number } | null;
  },
) {
  if (!can(ctx.role, "providers.manage")) throw forbidden();
  const row = await getRow(ctx, id);
  const baseUrl = input.baseUrl === undefined ? row.baseUrl : input.baseUrl;
  const clearingKey = input.apiKey === null;
  validateShape(row.providerType, baseUrl, input.apiKey, !!row.apiKeyEncrypted && !clearingKey);
  const patch: Partial<Row> = {};
  if (input.label !== undefined) patch.label = input.label;
  if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl;
  if (input.defaultModel !== undefined) patch.defaultModel = input.defaultModel;
  if (input.pricing !== undefined) patch.pricing = input.pricing;
  if (input.manualModels) {
    const discovered = row.models.filter((m) => !m.manual);
    const ids = new Set(discovered.map((m) => m.id));
    patch.models = [...discovered, ...input.manualModels.filter((m) => !ids.has(m)).map((m) => ({ id: m, manual: true }))];
  }
  if (input.apiKey) Object.assign(patch, await seal(input.apiKey, ctx.workspaceId, id));
  if (clearingKey) Object.assign(patch, { apiKeyEncrypted: null, apiKeyLast4: null, encryptionKeyVersion: null });
  if (input.apiKey !== undefined || input.baseUrl !== undefined) Object.assign(patch, { lastTestStatus: "untested", lastTestError: null });
  const [updated] = await db().update(schema.providerConnections).set(patch).where(eq(schema.providerConnections.id, id)).returning();
  await audit({
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    action: "provider.updated",
    targetType: "provider",
    targetId: id,
    metadata: { fields: Object.keys(input).filter((k) => k !== "apiKey"), keyChanged: input.apiKey !== undefined },
  });
  return toDTO(updated, ctx);
}

export async function remove(ctx: WorkspaceContext, id: string) {
  if (!can(ctx.role, "providers.manage")) throw forbidden();
  await getRow(ctx, id);
  await db().delete(schema.providerConnections).where(and(eq(schema.providerConnections.id, id), eq(schema.providerConnections.workspaceId, ctx.workspaceId)));
  await audit({ workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "provider.deleted", targetType: "provider", targetId: id });
}

/** Decrypts for server-side use only. Re-encrypts under the current key when an old key version was used. */
export async function connectionConfig(row: Row): Promise<ConnectionConfig> {
  let apiKey: string | null = null;
  if (row.apiKeyEncrypted && row.encryptionKeyVersion) {
    const ring = await appKeyRing();
    const sealed = { ciphertext: row.apiKeyEncrypted, keyVersion: row.encryptionKeyVersion };
    apiKey = decryptSecret(sealed, ring, aadFor(row.workspaceId, row.id));
    if (needsRotation(sealed, ring)) {
      const fresh = encryptSecret(apiKey, ring, aadFor(row.workspaceId, row.id));
      await db()
        .update(schema.providerConnections)
        .set({ apiKeyEncrypted: fresh.ciphertext, encryptionKeyVersion: fresh.keyVersion })
        .where(eq(schema.providerConnections.id, row.id));
    }
  }
  return { providerType: row.providerType, baseUrl: row.baseUrl, apiKey, policy: outboundPolicy() };
}

export function describeProviderError(err: unknown): string {
  if (err instanceof OutboundBlockedError) return err.message;
  if (err instanceof ProviderError) {
    if (err.kind === "auth") return "The provider rejected the API key.";
    if (err.kind === "not_found") return "The provider URL or endpoint was not found. Check the base URL.";
    if (err.kind === "rate_limit") return "The provider is rate limiting requests. Try again shortly.";
    return err.message;
  }
  return "Could not reach the provider.";
}

async function runTest(ctx: WorkspaceContext, row: Row) {
  const cfg = await connectionConfig(row);
  const adapter = getAdapter(row.providerType);
  try {
    const models = await adapter.listModels(cfg, AbortSignal.timeout(15_000));
    const manual = row.models.filter((m) => m.manual && !models.some((d) => d.id === m.id));
    const merged: StoredModel[] = [...models.map((m): StoredModel => ({ ...m })), ...manual];
    const [updated] = await db()
      .update(schema.providerConnections)
      .set({
        lastTestStatus: "ok",
        lastTestError: null,
        lastTestedAt: new Date(),
        models: merged,
        defaultModel: row.defaultModel ?? merged[0]?.id ?? null,
      })
      .where(eq(schema.providerConnections.id, row.id))
      .returning();
    return { ok: true as const, modelCount: models.length, connection: toDTO(updated, ctx) };
  } catch (err) {
    const message = describeProviderError(err);
    const [updated] = await db()
      .update(schema.providerConnections)
      .set({ lastTestStatus: "failed", lastTestError: message, lastTestedAt: new Date() })
      .where(eq(schema.providerConnections.id, row.id))
      .returning();
    return { ok: false as const, error: message, connection: toDTO(updated, ctx) };
  }
}

export async function test(ctx: WorkspaceContext, id: string) {
  if (!can(ctx.role, "providers.manage")) throw forbidden();
  return runTest(ctx, await getRow(ctx, id));
}

export const refreshModels = test;

/** Tests credentials before saving, without storing anything. */
export async function testDraft(ctx: WorkspaceContext, input: { providerType: ProviderType; baseUrl?: string | null; apiKey?: string | null }) {
  if (!can(ctx.role, "providers.manage")) throw forbidden();
  validateShape(input.providerType, input.baseUrl, input.apiKey, false);
  const adapter = getAdapter(input.providerType);
  try {
    const models: ModelInfo[] = await adapter.listModels(
      { providerType: input.providerType, baseUrl: input.baseUrl ?? null, apiKey: input.apiKey ?? null, policy: outboundPolicy() },
      AbortSignal.timeout(15_000),
    );
    return { ok: true as const, models };
  } catch (err) {
    return { ok: false as const, error: describeProviderError(err) };
  }
}
