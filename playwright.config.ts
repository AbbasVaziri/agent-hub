import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;
const env = {
  NODE_ENV: "production",
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://agenthub:agenthub@127.0.0.1:5440/agenthub_test",
  APP_URL: `http://localhost:${PORT}`,
  BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-0123456789",
  ENCRYPTION_KEYS: "1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  ALLOW_PRIVATE_PROVIDER_HOSTS: "true",
  // E2E signs up without a mail server; verification itself is covered by integration tests.
  REQUIRE_EMAIL_VERIFICATION: "false",
  RATE_LIMIT_CHAT_PER_MINUTE: "100",
};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, locale: "fa-IR", trace: "retain-on-failure" },
  // PW_CHANNEL=chrome reuses an installed Google Chrome instead of the downloaded build.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL || undefined } }],
  webServer: [
    { command: "npx tsx tests/support/mock-provider-server.ts", port: 4011, env: { MOCK_PROVIDER_PORT: "4011" }, reuseExistingServer: false },
    {
      command: `node --import tsx scripts/migrate.ts && npx next start -p ${PORT}`,
      port: PORT,
      env,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
