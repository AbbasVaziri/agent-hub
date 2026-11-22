import { z } from "zod";

const boolish = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  // Comma-separated "version:base64key" pairs. The highest version encrypts; all versions decrypt.
  ENCRYPTION_KEYS: z.string().min(1),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("Agent Hub <no-reply@localhost>"),
  // Trusted single-tenant mode: lets provider connections reach private networks (Ollama, local mocks).
  ALLOW_PRIVATE_PROVIDER_HOSTS: boolish,
  REQUIRE_EMAIL_VERIFICATION: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v !== "false"),
  RATE_LIMIT_CHAT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  MAX_CONCURRENT_RUNS_PER_WORKSPACE: z.coerce.number().int().positive().default(3),
  MONTHLY_BUDGET_USD_PER_WORKSPACE: z.coerce.number().nonnegative().default(50),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  cached = parsed.data;
  return cached;
}
