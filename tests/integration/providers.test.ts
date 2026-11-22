import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import * as providers from "@/lib/providers/service";
import { createMockProvider, MOCK_API_KEY } from "../support/mock-provider";
import { makeUser } from "../support/fixtures";

const mock = createMockProvider();
let baseUrl: string;
beforeAll(async () => {
  baseUrl = await mock.listen();
});
afterAll(() => mock.close());

describe("provider connections", () => {
  it("stores the API key encrypted and never returns it", async () => {
    const ctx = await makeUser();
    const dto = await providers.create(ctx, { label: "Mock", providerType: "openai_compatible", baseUrl, apiKey: MOCK_API_KEY });
    expect(JSON.stringify(dto)).not.toContain(MOCK_API_KEY);
    expect(dto).toMatchObject({ hasApiKey: true, apiKeyHint: `••••${MOCK_API_KEY.slice(-4)}` });
    const [row] = await db().select().from(schema.providerConnections).where(eq(schema.providerConnections.id, dto.id));
    expect(row.apiKeyEncrypted).toBeTruthy();
    expect(row.apiKeyEncrypted).not.toContain(MOCK_API_KEY);
    expect(row.encryptionKeyVersion).toBe(1);
    expect((await providers.connectionConfig(row)).apiKey).toBe(MOCK_API_KEY);
    const audit = await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.targetId, dto.id));
    expect(JSON.stringify(audit)).not.toContain(MOCK_API_KEY);
  });

  it("tests the connection and stores discovered models plus manual ones", async () => {
    const ctx = await makeUser();
    const dto = await providers.create(ctx, { label: "Mock", providerType: "openai_compatible", baseUrl, apiKey: MOCK_API_KEY, manualModels: ["custom-model"] });
    const res = await providers.test(ctx, dto.id);
    expect(res.ok).toBe(true);
    expect(res.connection.models.map((m) => m.id).sort()).toEqual(["custom-model", "mock-large", "mock-small"]);
    expect(res.connection.lastTestStatus).toBe("ok");
    expect(res.connection.defaultModel).toBeTruthy();
  });

  it("records a useful error for a bad key", async () => {
    const ctx = await makeUser();
    const dto = await providers.create(ctx, { label: "Bad", providerType: "openai_compatible", baseUrl, apiKey: "wrong-key" });
    const res = await providers.test(ctx, dto.id);
    expect(res).toMatchObject({ ok: false, error: "The provider rejected the API key." });
    expect(res.connection.lastTestStatus).toBe("failed");
  });

  it("keeps the stored key when updating other fields, and clears it on request", async () => {
    const ctx = await makeUser();
    const dto = await providers.create(ctx, { label: "Mock", providerType: "openai_compatible", baseUrl, apiKey: MOCK_API_KEY });
    expect((await providers.update(ctx, dto.id, { label: "Renamed" })).hasApiKey).toBe(true);
    expect((await providers.update(ctx, dto.id, { apiKey: null })).hasApiKey).toBe(false);
  });

  it("validates required fields per provider type", async () => {
    const ctx = await makeUser();
    await expect(providers.create(ctx, { label: "x", providerType: "openai" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(providers.create(ctx, { label: "x", providerType: "openai_compatible", apiKey: "k" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("draft tests do not persist anything", async () => {
    const ctx = await makeUser();
    const res = await providers.testDraft(ctx, { providerType: "openai_compatible", baseUrl, apiKey: MOCK_API_KEY });
    expect(res.ok).toBe(true);
    expect(await providers.list(ctx)).toHaveLength(0);
  });
});
