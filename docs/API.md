# API

All endpoints are JSON over HTTPS, authenticated with the session cookie set by `/api/auth/*`. Errors share one shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid input", "details": [] } }
```

| Code | Status |
|---|---|
| UNAUTHENTICATED | 401 |
| FORBIDDEN | 403 |
| NOT_FOUND | 404 (also used for resources in other workspaces) |
| CONFLICT | 409 |
| VALIDATION_ERROR, OUTBOUND_BLOCKED, LIMIT_EXCEEDED | 422 |
| RATE_LIMITED | 429 |
| BUDGET_EXCEEDED | 402 |
| INTERNAL_ERROR | 500 |

State-changing requests from a browser must come from `APP_URL`'s origin.

## Auth
`/api/auth/*` is handled by better-auth: `sign-up/email`, `sign-in/email`, `sign-out`, `verify-email`, `send-verification-email`, `request-password-reset`, `reset-password`, `delete-user`, `get-session`.

## Account and workspaces
| Method | Path | Notes |
|---|---|---|
| GET, PATCH | `/api/me` | profile, locale, memberships |
| GET, POST | `/api/workspaces` | list, create |
| POST | `/api/workspaces/switch` | `{ workspaceId }` |
| GET, PATCH, DELETE | `/api/workspaces/:id` | delete needs `{ confirmName }`, owner only |
| GET | `/api/workspaces/:id/members` | |
| PATCH, DELETE | `/api/workspaces/:id/members/:memberId` | `{ role }` |
| GET, POST | `/api/workspaces/:id/invitations` | `{ email, role }` |
| DELETE | `/api/workspaces/:id/invitations/:invitationId` | revoke |
| POST | `/api/invitations/accept` | `{ token }` |

## Providers
| Method | Path | Notes |
|---|---|---|
| GET, POST | `/api/providers` | `{ label, providerType, baseUrl?, apiKey?, defaultModel?, manualModels?, pricing? }` |
| POST | `/api/providers/test-draft` | test before saving; nothing stored |
| GET, PATCH, DELETE | `/api/providers/:id` | omit `apiKey` to keep it, `null` to clear |
| POST | `/api/providers/:id/test` | test and refresh models |
| GET, POST | `/api/providers/:id/models` | list with capabilities, refresh |

Responses never include the key, only `hasApiKey` and `apiKeyHint` (last four characters).

## Agents and tools
| Method | Path |
|---|---|
| GET, POST | `/api/agents` |
| GET, PUT, DELETE | `/api/agents/:id` |
| POST | `/api/agents/:id/duplicate` |
| GET | `/api/tools` |

## Conversations and runs
| Method | Path | Notes |
|---|---|---|
| GET, POST | `/api/conversations` | `?cursor=&limit=&status=` |
| GET, PATCH, DELETE | `/api/conversations/:id` | title, visibility, status, model override |
| GET | `/api/conversations/:id/messages` | timeline plus `activeRun` |
| PUT | `/api/conversations/:id/agent` | manual switch, does not count as a handoff |
| POST | `/api/chat/stream` | SSE; body `{ conversationId, content, clientMessageId, retryOfMessageId? }` |
| GET | `/api/runs/:id` | status and usage |
| GET | `/api/runs/:id/events?after=N` | SSE replay and follow |
| POST | `/api/runs/:id/cancel` | |
| POST | `/api/approvals/:id/approve`, `/reject` | |

### SSE events
`run`, `chunk`, `reasoning`, `tool_call`, `tool_result`, `delegation`, `handoff`, `approval_required`, `approval_resolved`, `error`, `done`. Each frame has `id: <seq>`; schemas are in `src/lib/ai/events.ts`. Comment frames (`: ping`) are heartbeats.

## Usage
| Method | Path |
|---|---|
| GET | `/api/usage?days=30` |
| GET | `/api/audit?limit=50` |
