# API

JSON over HTTP, served by the same Next.js app as the UI (`src/app/api/**/route.ts`). Handlers are thin. Each one
parses and validates input with zod, calls a module in `src/modules`, and returns JSON. Wrappers in
`src/lib/http/api.ts` apply authentication, roles, the CSRF check and error formatting.

## Conventions

- **Authentication**: the session cookie (`__Host-lp_session` in production, which forces Secure, `Path=/` and no
  `Domain`; `lp_session` in development), HttpOnly and SameSite=Lax, set by
  `POST /api/auth/login`. Sessions are stored server-side (only an HMAC hash of the token) and expire after
  `SESSION_TTL_HOURS` (default 72).
- **Roles**: `VIEWER < OPERATOR < ADMIN`. Each endpoint below lists its minimum role. Users only ever see their own
  profiles, runs, jobs, leads, notifications and recipients; another user's resource answers **404**, not 403.
- **CSRF**: every state-changing request (POST, PATCH, PUT, DELETE) on a cookie route must carry an `Origin` header
  equal to `APP_BASE_URL`; otherwise `403 CSRF_REJECTED`. Requests without an `Origin` are refused (fail closed).
- **Success**: `{ "data": … }`. Lists: `{ "data": [...], "meta": { page, pageSize, total, totalPages } }` with
  `?page` (1–10000) and `?pageSize` (1–100, default 25).
- **Errors**: `{ "error": { "code", "message", "requestId", "details"? } }`. `details` holds field errors for
  validation failures (`[{ path, message }]`, at most 20). No stack traces or secrets are returned.
- **Request id**: every response has `x-request-id` (an incoming valid one is reused), also written to the logs.
- **Body limit**: 256 KB.

| Code                                                                  | HTTP | Meaning                                                 |
| --------------------------------------------------------------------- | ---- | ------------------------------------------------------- |
| `VALIDATION_ERROR`                                                    | 400  | Invalid body, query or path parameter                   |
| `IDEMPOTENCY_KEY_REQUIRED`                                            | 400  | `POST /api/runs` without `Idempotency-Key`              |
| `UNAUTHENTICATED`                                                     | 401  | No valid session                                        |
| `INVALID_SIGNATURE`                                                   | 401  | Bad HMAC on an internal call or webhook                 |
| `FORBIDDEN`                                                           | 403  | Role too low                                            |
| `CSRF_REJECTED`                                                       | 403  | Missing or foreign `Origin`                             |
| `NOT_FOUND`                                                           | 404  | Missing, or belongs to another user                     |
| `CONFLICT`                                                            | 409  | Concurrent modification or duplicate                    |
| `VERSION_CONFLICT`                                                    | 409  | Profile saved from a stale version (optimistic locking) |
| `RUN_ALREADY_ACTIVE`                                                  | 409  | The profile already has a queued or running run         |
| `LEASE_HELD`                                                          | 409  | Another executor is processing the run                  |
| `INVALID_STATE`                                                       | 409  | Action not allowed in the current status                |
| `RATE_LIMITED`                                                        | 429  | Too many requests; `Retry-After` header set             |
| `INTEGRATION_NOT_CONFIGURED`                                          | 503  | Required provider settings are missing                  |
| `SOURCE_NOT_AUTHORIZED`, `SOURCE_UNAVAILABLE`, `EXECUTOR_UNAVAILABLE` | 503  | External dependency unavailable                         |
| `INTERNAL_ERROR`                                                      | 500  | Unexpected error (logged with the request id)           |

## Endpoints

### Authentication and health

| Method | Path                 | Access | Purpose                                                                                                       |
| ------ | -------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/auth/login`    | public | `{ email, password }` → sets the session cookie. Same 401 for unknown e-mail and wrong password. Rate limited |
| POST   | `/api/auth/logout`   | public | Deletes the session                                                                                           |
| GET    | `/api/auth/me`       | VIEWER | The signed-in user                                                                                            |
| POST   | `/api/auth/password` | VIEWER | Change own password; ends the user's other sessions. Rate limited                                             |
| GET    | `/api/health`        | public | `{ status: "ok" }` and nothing else (used by Docker health checks)                                            |

### Search profiles

| Method | Path                          | Access   | Purpose                                                                                                                                                               |
| ------ | ----------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/profiles`               | VIEWER   | List own profiles (`?includeArchived=true` to include archived ones)                                                                                                  |
| POST   | `/api/profiles`               | OPERATOR | Create (version 1). Configuration validated server-side (weights sum to 100, etc.)                                                                                    |
| GET    | `/api/profiles/:id`           | VIEWER   | Profile with its current configuration                                                                                                                                |
| PATCH  | `/api/profiles/:id`           | OPERATOR | Save a new version; requires the version being edited (`VERSION_CONFLICT` if stale). The UI's "Restore this version" saves an old configuration through this endpoint |
| GET    | `/api/profiles/:id/versions`  | VIEWER   | Version history with authors                                                                                                                                          |
| POST   | `/api/profiles/:id/archive`   | OPERATOR | Archive; archived profiles cannot run or be edited                                                                                                                    |
| POST   | `/api/profiles/:id/restore`   | OPERATOR | Un-archive                                                                                                                                                            |
| POST   | `/api/profiles/:id/duplicate` | OPERATOR | Copy as a new profile at version 1                                                                                                                                    |
| POST   | `/api/profiles/:id/default`   | OPERATOR | Make it the default profile                                                                                                                                           |

### Runs

| Method | Path                          | Access   | Purpose                                                                                                     |
| ------ | ----------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| GET    | `/api/runs`                   | VIEWER   | Own runs, filterable by status, profile and date (paginated)                                                |
| POST   | `/api/runs`                   | OPERATOR | `{ profileId }` with header `Idempotency-Key`. 201 new run; 200 when the key was already used. Rate limited |
| GET    | `/api/runs/:id`               | VIEWER   | Run details and stages (no configuration snapshot or lease data)                                            |
| GET    | `/api/runs/:id/events`        | VIEWER   | Progress for polling: run, counters, stages, `terminal`                                                     |
| GET    | `/api/runs/:id/jobs`          | VIEWER   | Jobs the run saw, with filter and AI results                                                                |
| GET    | `/api/runs/:id/notifications` | VIEWER   | Alerts created by the run                                                                                   |
| POST   | `/api/runs/:id/cancel`        | OPERATOR | Cancel a queued run, or request cancellation of a running one                                               |
| POST   | `/api/runs/:id/resume`        | OPERATOR | Re-dispatch a stalled run after its lease expired (`LEASE_HELD` before that)                                |

### Jobs, leads and exports

| Method | Path                     | Access | Purpose                                                                                                   |
| ------ | ------------------------ | ------ | --------------------------------------------------------------------------------------------------------- |
| GET    | `/api/jobs`              | VIEWER | All jobs from own runs, filterable (decision, budget, dates, text)                                        |
| GET    | `/api/jobs/:id`          | VIEWER | Job with filter results, AI evaluation and alerts                                                         |
| GET    | `/api/leads`             | VIEWER | Qualified jobs                                                                                            |
| GET    | `/api/leads/:id`         | VIEWER | One lead                                                                                                  |
| GET    | `/api/exports/leads.csv` | VIEWER | CSV with the leads filters; capped row count with a truncation flag; formula-injection safe. Rate limited |
| GET    | `/api/exports/runs.csv`  | VIEWER | CSV of runs. Rate limited                                                                                 |
| GET    | `/api/dashboard`         | VIEWER | Totals and funnel for the user's own runs                                                                 |

### Notifications and recipients

| Method | Path                           | Access   | Purpose                                                                                                                                    |
| ------ | ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/notifications`           | VIEWER   | Own alerts, filterable by status                                                                                                           |
| POST   | `/api/notifications/:id/retry` | OPERATOR | Retry a failed alert; an `UNCERTAIN` one only after 15 minutes and with `confirmNotReceived: true`. Rate limited                           |
| GET    | `/api/recipients`              | VIEWER   | Own recipients (phone numbers and e-mail addresses masked)                                                                                 |
| POST   | `/api/recipients`              | OPERATOR | WhatsApp: `{ label, phoneE164, optInConfirmed }` (E.164, `channel` optional); e-mail: `{ channel: "EMAIL", label, email, optInConfirmed }` |
| PATCH  | `/api/recipients/:id`          | OPERATOR | `{ label?, optInConfirmed?, archived? }`: rename, confirm opt-in, archive                                                                  |

### Integrations and administration

| Method | Path                                      | Access   | Purpose                                                                             |
| ------ | ----------------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| GET    | `/api/integrations/status`                | VIEWER   | Stored state of database, job source, AI, WhatsApp, e-mail, n8n (no external calls) |
| POST   | `/api/integrations/:provider/check`       | OPERATOR | Live connection check for one integration; result stored. Rate limited              |
| POST   | `/api/integrations/{whatsapp,email}/test` | OPERATOR | Send a test to an opted-in recipient of that channel (audited). Rate limited        |
| GET    | `/api/import-tokens`                      | OPERATOR | Own import tokens (never the token itself)                                          |
| POST   | `/api/import-tokens`                      | OPERATOR | `{ name }` → 201 with `data.token`, shown once (audited). Rate limited              |
| POST   | `/api/import-tokens/:id/revoke`           | OPERATOR | Revoke an own token immediately (audited)                                           |
| GET    | `/api/audit-logs`                         | ADMIN    | Audit log, filterable by action, actor and date                                     |

### Job import (Upwork sync agent)

Authenticated with `Authorization: Bearer lpi_…` (an import token); no cookie, so no CSRF check. The request acts as
the token's user (OPERATOR or higher), with the same ownership rules. See [upwork-sync.md](upwork-sync.md).

| Method | Path                      | Purpose                                                                                                                                                                                                 |
| ------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/import/context`     | `?scheduled=true` from the scheduler. Profiles with Upwork sync on: keywords, filters, last sync, `due`, limits                                                                                         |
| POST   | `/api/import/jobs/screen` | `{ profileId, origin: "upwork-mcp", jobs[≤100] }` → `{ received, valid, rejected, invalid[], detailsWanted[] }`; stores nothing                                                                         |
| POST   | `/api/import/jobs`        | Same body → stages the jobs and starts an import run: 202 `{ status: STARTED \| QUEUED \| FAILED, runId, error, accepted, invalid[] }`; `FAILED` means the run could not start and the jobs stay queued |
| POST   | `/api/import/sync-status` | `{ profileId, status: OK \| PARTIAL \| ERROR, message? }` → records the sync time for the schedule                                                                                                      |

Each job is an Upwork MCP `find_jobs` search item, optionally with the raw `find_jobs get` response as `details`
(contract: `upworkMcpJobSchema` in `src/modules/job-sources/upwork-import/normalize.ts`). Invalid items are reported
by index and skipped; the rest are imported.

### Machine-to-machine

| Method | Path                                 | Access                       | Purpose                                                                     |
| ------ | ------------------------------------ | ---------------------------- | --------------------------------------------------------------------------- |
| POST   | `/api/internal/runs/:id/steps/:step` | HMAC (`INTERNAL_API_SECRET`) | Run one pipeline step (n8n). See [n8n docs](../n8n/documentation/README.md) |
| POST   | `/api/internal/runs/:id/fail`        | HMAC (`INTERNAL_API_SECRET`) | Mark a run failed from n8n's error branch; honours the lease                |
| GET    | `/api/webhooks/whatsapp`             | verify token                 | Meta's subscription handshake (`hub.verify_token` must match)               |
| POST   | `/api/webhooks/whatsapp`             | `X-Hub-Signature-256`        | Delivery status updates; signature checked with `WHATSAPP_APP_SECRET`       |

Caddy answers `/api/internal/*` with 404 in production, so these routes are reachable only on the Docker network.

## Rate limits

Fixed windows stored in Postgres (`src/lib/security/rate-limit.ts`), so they hold across app instances.

| Rule                | Limit             | Counted per                    |
| ------------------- | ----------------- | ------------------------------ |
| Login               | 10 per 15 minutes | client IP, and e-mail (hashed) |
| Password change     | 5 per 15 minutes  | user                           |
| Start run           | 10 per minute     | user                           |
| Notification retry  | 20 per minute     | user                           |
| WhatsApp test       | 3 per 10 minutes  | user                           |
| Integration check   | 20 per minute     | user                           |
| CSV export          | 10 per minute     | user                           |
| Import API          | 60 per minute     | import token                   |
| Create import token | 10 per hour       | user                           |

## Not implemented

No public API tokens (cookie sessions only), no user management endpoints (users come from the seed or the
database), no hard delete of profiles or runs, no OpenAPI document.
