# Agent Hub

A multi-tenant workspace for building your own AI agents and talking to them. Users connect their own model providers, create agents with their own instructions, tools and limits, and chat with them over a streaming interface. A lead agent can delegate a task to a subagent or hand the conversation to another agent. Persian (RTL) is the default interface language; English is available from the account menu.

> فارسی: این برنامه فضای کاری چندکاربره برای ساخت عامل‌های هوش مصنوعی است. هر کاربر کلید API سرویس‌دهنده‌ی خودش را وصل می‌کند، عامل می‌سازد و با آن گفتگو می‌کند. رابط کاربری پیش‌فرض فارسی و راست‌به‌چپ است.

## What works

- Email and password sign-up, email verification, sign-in, sign-out, password reset, account deletion (better-auth, HttpOnly session cookies).
- Workspaces with owner, admin, member and viewer roles, invitations, role changes, a personal workspace per user.
- Provider connections for OpenAI, Anthropic, OpenRouter, Ollama and any OpenAI-compatible server: connection test, model discovery, manual model ids, default model, optional pricing for cost estimates. Keys are encrypted with AES-256-GCM and never sent back to the browser.
- Agent builder: identity, instructions, tone, seal colour, mode (primary, subagent, both), provider and model, tools, approval requirement, delegation and handoff targets, execution limits.
- Chat: streaming replies over SSE, Markdown with code highlighting, copy, retry, stop, rename, share with workspace, delete, per-conversation model override, agent switching.
- Multi-agent runtime: `calculate`, `get_current_datetime`, `delegate_to_agent` (one level deep), `handoff_to_agent` (max three automatic handoffs per conversation, no bounce back), approvals for tool calls, server-enforced budgets.
- Durable run event log: a refreshed or reconnected browser picks the stream up where it left off.
- Usage per model and per agent (estimated cost), monthly workspace budget, rate limits, audit log of sensitive actions.

## Prerequisites

- Node.js 24
- Docker (for PostgreSQL), or any PostgreSQL 15+ you point `DATABASE_URL` at

## Setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

```bash
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 48)" >> .env.local
echo "ENCRYPTION_KEYS=1:$(openssl rand -base64 32)" >> .env.local
```

Start the database and apply migrations:

```bash
docker compose up -d
npm run db:migrate
```

The compose file also creates `agenthub_test`, used by the integration and end-to-end tests.

## Development

```bash
npm run dev
```

Open http://localhost:3000. Without `SMTP_URL`, verification and reset emails are stored in the database and shown at `/dev/outbox` (development only).

To try the app without a paid API key, run the deterministic mock provider and add an "OpenAI-compatible" connection with base URL `http://127.0.0.1:4010/v1` and key `mock-test-key` (requires `ALLOW_PRIVATE_PROVIDER_HOSTS=true`):

```bash
npm run mock-provider
```

Messages containing `[calc:2+3]`, `[delegate] task`, `[handoff]`, `[slow]` or `[fail]` exercise tools, delegation, handoff, stop and provider errors.

## Tests

```bash
npm run typecheck
npm run lint
npm test               # unit + integration (needs the agenthub_test database)
npm run build
npm run test:e2e       # Playwright; builds must exist. PW_CHANNEL=chrome uses an installed Chrome
```

Integration tests drop and recreate the schema of a database whose name must end in `_test`.

## Production

```bash
npm run build
npm run db:migrate
npm start
```

Required in production: `DATABASE_URL`, `APP_URL` (https), `BETTER_AUTH_SECRET`, `ENCRYPTION_KEYS`, `SMTP_URL`, `MAIL_FROM`. Keep `ALLOW_PRIVATE_PROVIDER_HOSTS=false` for any deployment that serves more than one trusted team.

Run a single app instance for now, or read the scaling notes in [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [Security](docs/SECURITY.md)
- [Known limitations](docs/LIMITATIONS.md)
- [Design direction](DESIGN.md)
