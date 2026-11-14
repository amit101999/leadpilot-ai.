# Architecture

One Next.js application serves the UI and the JSON API. PostgreSQL holds all state. External services (job source,
AI model, e-mail) sit behind provider interfaces chosen by environment variables, with mocks as the default. n8n is
an optional orchestrator that drives runs through the app's own API; it holds no business logic.

```
 Browser ──HTTPS──► Caddy ──► Next.js app ─────────────────► PostgreSQL   (or Cloudflare ► cloudflared ► Caddy, see deployment.md)
                               │  UI (App Router, React)      15 tables, Drizzle
                               │  API (src/app/api/**)
                               │  Modules (src/modules/**)
                               │
                               ├─► Job source provider ──► mock feed | Upwork API (blocked) | imported jobs
                               │     ▲ Claude + Upwork MCP ──Bearer token──► /api/import/* (docs/upwork-sync.md)
                               ├─► AI evaluator ─────────► mock | OpenAI Responses API
                               ├─► E-mail provider ──────► mock | SMTP (e.g. Gmail)
                               │
                               └─► n8n webhook (RUN_EXECUTOR=n8n)
                                     n8n ──HMAC-signed──► /api/internal/runs/:id/steps/:step
```

## Code layout

| Path                       | Responsibility                                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/(app)/**`         | Signed-in pages (server components load data; client components handle interaction)                                                                                                     |
| `src/app/login`            | Sign-in page                                                                                                                                                                            |
| `src/app/api/**`           | Thin route handlers: parse and validate input, call a module, return JSON                                                                                                               |
| `src/proxy.ts`             | Redirects signed-out page requests to `/login?next=…` (Next.js 16 "proxy", formerly middleware)                                                                                         |
| `src/modules/*`            | Business logic per domain: `profiles`, `runs` (engine), `qualification`, `ai`, `notifications`, `job-sources`, `jobs`, `dashboard`, `exports`, `audit`, `integrations`, `auth`, `users` |
| `src/modules/providers.ts` | Picks real or mock providers from the environment; tests inject their own                                                                                                               |
| `src/lib/*`                | Shared infrastructure: env validation, database client and schema, auth, HTTP wrappers, security helpers, money, logging, UI helpers                                                    |
| `src/components/**`        | React components per page area, plus `ui/` primitives                                                                                                                                   |
| `database/`                | Migrations (`migrations/`), migrate runner, seed                                                                                                                                        |
| `n8n/workflows/`           | The run workflow imported into n8n                                                                                                                                                      |

Route handlers use one of three wrappers from `src/lib/http/api.ts`: `userRoute(minRole, …)` (session cookie, role
check, same-origin check on state-changing methods), `internalRoute` (HMAC-signed, for n8n) and `publicRoute` (login,
logout, health); the import API uses `tokenRoute` (Bearer import token). The wrappers also attach a request id and turn
every error into the standard error JSON.

## Run lifecycle

```
POST /api/runs (Idempotency-Key)
   │  createRun: freeze the profile configuration into agent_runs.configuration_snapshot,
   │             create 7 run_stages rows, status QUEUED
   ▼
dispatchRun ── inprocess: next/server after() → runInProcess (same server process)
           └── n8n:       POST n8n webhook → n8n calls one step at a time
   ▼
runStep(step), each idempotent and protected by a lease (lease_owner, lease_expires_at):
  start     → SOURCE_CHECK   provider.checkConnection(); NOT_AUTHORIZED → BLOCKED_SOURCE (terminal)
  discover  → DISCOVERY      page through the source, normalize, upsert jobs, link run_jobs (dedup)
  filter    → HARD_FILTERS   deterministic rules; failures never reach the AI
  evaluate  → AI_EVALUATION  batches of AI_BATCH_SIZE, AI_CONCURRENCY in parallel; schema-validated output;
                             the app computes the authoritative weighted score
  select    → SELECTION      rank (score, discovery time, source id); reserve up to maxPerRun notifications
  notify    → NOTIFICATION   claim → send → record, NOTIFY_BATCH_SIZE at a time
  finalize  → FINALIZATION   counters, COMPLETED or COMPLETED_WITH_ERRORS, optional run summary message
```

Each step returns `{ next, terminal, retryAfterMs }`. The in-process runner loops with bounded per-step retries and
fails the run if a step keeps failing. The n8n workflow does the same over HTTP: it retries a step 3 times, leaves a run
alone when another execution holds the lease (`LEASE_HELD`), and otherwise reports the failure to
`/api/internal/runs/:id/fail`. A run stuck after a crash can be resumed (`POST /api/runs/:id/resume`) once its lease
has expired. The UI follows progress by polling `GET /api/runs/:id/events` every 2 seconds.

Run statuses: `QUEUED → RUNNING → COMPLETED | COMPLETED_WITH_ERRORS | FAILED | CANCELLED | BLOCKED_SOURCE`.
Transitions are declared in `src/modules/runs/transitions.ts`; any other transition raises `INVALID_STATE`.

## Qualification

1. **Hard filters** (`src/modules/qualification`): budget minimum (exact decimal arithmetic, `$499.99` fails `$500`),
   fixed-price only, payment verification required (unknown counts as not verified), currency policy (foreign
   currency is UNKNOWN unless a fixed rate is configured), required/optional skills with aliases and word boundaries,
   include/exclude keywords, client rating/hires/spend/location, URL host checks, and "already notified to this
   recipient".
2. **AI evaluation** (`src/modules/ai`): the model gets only a minimal profile slice and the job text. Its output must
   match a strict schema (`output-schema.ts`); invalid output is retried within the profile's `maxRetries` and
   otherwise recorded as `AI_ERROR`. The model's own total score is ignored. The app computes the weighted score from
   the five dimension scores (integer, round half up). The prompt version and a hash of the input are stored with each
   qualification.
3. **Eligibility**: qualified only if hard filters passed, the output was valid, the score reaches the threshold
   (default 75), and no disqualifying risk flag applies.

## Notifications and delivery guarantees

Alerts are e-mails (SMTP) to the profile's opted-in e-mail recipient (`src/modules/notifications/channels.ts`); the
same recipient gets the optional run summary and failure alert. WhatsApp alerts were removed; their old rows stay in
the database (channel `WHATSAPP`) and are never sent. Selection reserves at most `maxPerRun` notification rows under a
per-recipient advisory lock. A unique index on `(job_id, channel, recipient_id)` makes "never alert the same job to
the same recipient twice" a database guarantee, even for concurrent runs. Sending is claim → send → record. The SMTP
provider classifies every result (`classifySmtpError` in `src/modules/notifications/smtp-email.ts`):

- **accepted** (the mail server took the message): `SENT`. Not proof that it reached the inbox.
- **rejected**: `FAILED_RETRYABLE` (4xx replies, connection refused or DNS failure before sending), retried
  automatically within the run with exponential backoff (2 s doubling, at most 30 s) up to 3 attempts; then, or for
  5xx and login errors, `FAILED_PERMANENT`, which an operator can retry manually.
- **uncertain** (timeout, connection dropped mid-session): `UNCERTAIN`. Never retried automatically. A manual retry is
  allowed only after 15 minutes and with an explicit "the recipient did not get it" confirmation.

The guarantee is **at most once per (job, recipient)**, not exactly once: an uncertain send may or may not have arrived.

## Key design decisions

| Decision                                                         | Why                                                                               | Trade-off                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------ |
| One Next.js app for UI and API                                   | One deployable, shared types and validation                                       | API and UI scale together                              |
| n8n calls the app's step API instead of reimplementing the logic | One engine, testable in-process; n8n failure → switch to `RUN_EXECUTOR=inprocess` | Every step is an HTTP round trip                       |
| Steps are idempotent with leases                                 | Safe retries, duplicate triggers, crash recovery                                  | More state per run (stages, leases)                    |
| Configuration snapshot frozen per run (DB trigger)               | Results stay explainable after profile edits                                      | Snapshot duplicates profile data                       |
| Database constraints for dedup and alert uniqueness              | Correct under concurrency without application locks                               | Callers must handle unique violations (mapped to 409)  |
| Short polling (2 s) instead of SSE/WebSockets                    | Simple, works through any proxy                                                   | Up to 2 s delay, one request per 2 s per open run page |
| Mock providers by default                                        | No accidental external calls or costs; full flow works offline                    | Live integrations need separate verification           |
| Upwork adapter refuses to discover until access is confirmed     | No scraping, no guessed endpoints                                                 | No live data yet                                       |

## Scalability and failure modes

- One web container handles UI, API and (with `inprocess`) run execution. In-process runs live in the server process:
  a restart interrupts them, and they need `resume` after the lease expires. With n8n, execution survives web
  restarts.
- Discovery is capped (pages and jobs per run) and records a `DISCOVERY_LIMIT_REACHED` warning when truncated.
- AI calls are bounded by batch size and concurrency; rate limits and timeouts are classified and retried within the
  profile's limits.
- Postgres is the only stateful dependency; backups: [deployment.md](deployment.md#backups).
- Not built: horizontal scaling of in-process execution (one active run per profile is enforced, but several web
  instances would each run their own in-process jobs), queue-based workers, metrics/alerting beyond logs.
