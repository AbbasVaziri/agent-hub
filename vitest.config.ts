import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const TEST_ENV: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://agenthub:agenthub@127.0.0.1:5440/agenthub_test",
  APP_URL: "http://localhost:3100",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
  ENCRYPTION_KEYS: "1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  ALLOW_PRIVATE_PROVIDER_HOSTS: "true",
  REQUIRE_EMAIL_VERIFICATION: "true",
  MAX_CONCURRENT_RUNS_PER_WORKSPACE: "3",
};

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    env: TEST_ENV,
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" } },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/support/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
