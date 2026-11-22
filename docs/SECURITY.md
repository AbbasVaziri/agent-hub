# Security

## Implemented
- Sessions: better-auth with HttpOnly, SameSite=Lax cookies (Secure when `APP_URL` is https). Nothing auth-related is kept in localStorage. Passwords are hashed by better-auth (scrypt).
- CSRF: SameSite cookies plus an Origin check on every state-changing API request.
- Authorization: a single permission matrix (`src/lib/workspaces/permissions.ts`), checked in services. Conversations are private to their creator unless shared; admins and owners can read all.
- Tenant isolation: every query on workspace data filters by the server-resolved workspace. Cross-tenant tests live in `tests/integration/tenant-isolation.test.ts`.
- Provider keys: AES-256-GCM with a random 96-bit IV, auth tag, and AAD binding the ciphertext to `workspaceId:connectionId`. Keys are versioned (`ENCRYPTION_KEYS=1:...,2:...`); old ciphertexts are re-encrypted with the newest key when used.
- SSRF: protocol allowlist, no credentials in URLs, no redirects, blocked private, loopback, link-local, CGNAT, metadata and IPv6 local ranges. The DNS answer is checked inside the socket's `lookup`, so the address that is validated is the address that is connected to (no rebinding window). Connect and idle timeouts and a response size cap apply.
- Trusted mode: `ALLOW_PRIVATE_PROVIDER_HOSTS=true` allows private hosts for single-tenant or self-hosted installs (Ollama). It is off by default.
- Rate limits: per user for chat, per IP for auth, per user for provider tests, per workspace for invitations, stored in Postgres.
- Execution limits are enforced in server code (`execution-budget.ts`), never by prompt.
- Tools: Zod-validated input, explicit allowlist per agent, idempotent by `(run_id, tool_call_id)`, approvals decided only through authenticated endpoints. The calculator is a parser, not `eval`.
- Output: Markdown is rendered without raw HTML; links open with `noopener noreferrer`; images are not loaded.
- Logs: structured JSON with key-name and pattern-based secret redaction. Conversation content is not logged.
- Errors: users get stable codes and short messages; stack traces stay in server logs.
- Headers: `X-Frame-Options: DENY`, `nosniff`, strict referrer policy.

## Not implemented yet
- PostgreSQL row-level security. Isolation relies on application checks and tests.
- A Content Security Policy header.
- Two-factor authentication and OAuth sign-in.
- Distributed rate limiting beyond Postgres counters.
