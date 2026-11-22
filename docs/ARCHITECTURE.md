# Architecture

One Next.js application (App Router) serves the UI and the REST API. There is no separate backend service.

```
Browser (React, TanStack Query, useChatStream)
  │  fetch + SSE over POST
  ▼
Route handlers (src/app/api/**)          validate with Zod, authenticate, resolve workspace
  │
  ▼
Services (src/lib/*/service.ts)          authorization + workspace-scoped queries
  │
  ├── Orchestrator (src/lib/ai/orchestration)
  │     orchestrator.ts      run lifecycle, idempotency, cancellation, handoff loop
  │     agent-runtime.ts     model turns, tool execution, usage
  │     delegation.ts        subagent runs (depth 1)
  │     handoff.ts           conversation transfer under a row lock
  │     tool-registry.ts     typed tools with Zod schemas
  │     approval-engine.ts   human approval for tool calls
  │     execution-budget.ts  iteration/tool/token/cost/time limits
  │     run-events.ts        durable event log + in-process bus
  │
  ├── Provider gateway (src/lib/ai/providers)
  │     openai, anthropic, openrouter, ollama, openai-compatible adapters
  │     all outbound HTTP goes through src/lib/security/ssrf.ts
  │
  └── PostgreSQL via Drizzle (src/lib/db/schema.ts, drizzle/ migrations)
```

## Request flow for a chat message

1. `POST /api/chat/stream` with `{ conversationId, content, clientMessageId }`.
2. The orchestrator checks access, the per-conversation single-run rule, workspace concurrency and the monthly budget, then inserts the user message, an empty assistant message and a `queued` run in one transaction. `clientMessageId` is the run's idempotency key, so a retried request attaches to the same run.
3. The run executes detached from the HTTP request. Every event is written to `run_events` (with a sequence number) before it is published on an in-process bus.
4. The response is an SSE view of that log: replay after `Last-Event-ID`, then live events. If the browser disconnects, the run continues; `GET /api/runs/:id/events?after=N` resumes.
5. `POST /api/runs/:id/cancel` sets `cancel_requested_at` and aborts the local controller. Provider calls, tools and child runs share the abort signal.

## Cancellation and recovery policy

| Situation | Result |
|---|---|
| User presses stop | Run becomes `cancelled`; partial text is kept with status `cancelled`. |
| Browser tab closes or network drops | Run keeps going. The client reconnects with backoff and replays missed events. |
| Provider error | Run becomes `failed` with a stable code (`PROVIDER_ERROR`, `PROVIDER_AUTH_ERROR`, ...). |
| Limit reached | Run becomes `failed` with `LIMIT_EXCEEDED`. |
| App process dies mid-run | The run is marked `failed` with `INTERRUPTED` by the stale-run reaper on the next request in that workspace. |

## Agents and context

- The system prompt is assembled in layers (`src/lib/ai/chat/chat-context.ts`): platform rules first, then the agent's own text fenced as workspace-provided data, then tools, peers, limits and any handoff summary.
- History is passed as separate user and assistant messages, trimmed by a message window and an estimated token budget.
- Subagents receive only the task prompt, never the conversation.

## Tenancy

Every workspace-owned table carries `workspace_id`. The active workspace is stored on the user row and re-validated against `workspace_members` on every request. Routes that name a workspace in the URL go through `contextFor`, which checks membership. Lookups by id always include the workspace in the `WHERE` clause, and hidden resources return 404.
