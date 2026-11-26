# Architecture

One Next.js application serves the UI and the JSON API. PostgreSQL holds all state. External services (job source,
AI model, e-mail) sit behind provider interfaces (`src/modules/providers.ts`). The app always uses the real ones;
the automated tests substitute fakes from `tests/fakes`. Runs execute inside the app process.

```
 Browser ──HTTPS──► Render (TLS) ──► Next.js app (Docker) ─────────► Neon PostgreSQL
                                  │  UI (App Router, React)          Drizzle
                                  │  API (src/app/api/**)
                                  │  Modules (src/modules/**), run engine (in-process)
                                  │
                                  ├─► Job source: imported jobs only
                                  │     ▲ Claude cloud routine + Upwork MCP ──Bearer token──► /api/import/* (docs/upwork-sync.md)
                                  ├─► AI evaluator ─────► OpenAI Responses API
                                  └─► E-mail provider ──► Brevo HTTPS API | SMTP
```

## Code layout

| Path                       | Responsibility                                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/(app)/**`         | Signed-in pages (server components load data; client components handle interaction)                                                                                                     |
| `src/app/login`            | Sign-in page                                                                                                                                                                            |
| `src/app/api/**`           | Thin route handlers: parse and validate input, call a module, return JSON                                                                                                               |
| `src/proxy.ts`             | Redirects signed-out page requests to `/login?next=…` (Next.js 16 "proxy", formerly middleware)                                                                                         |
| `src/modules/*`            | Business logic per domain: `profiles`, `runs` (engine), `qualification`, `ai`, `notifications`, `job-sources`, `jobs`, `dashboard`, `exports`, `audit`, `integrations`, `auth`, `users` |
| `src/modules/providers.ts` | Builds the real providers (import source, OpenAI, SMTP or Brevo); tests substitute fakes from `tests/fakes`                                                                             |
| `src/lib/*`                | Shared infrastructure: env validation, database client and schema, auth, HTTP wrappers, security helpers, money, logging, UI helpers                                                    |
| `src/components/**`        | React components per page area, plus `ui/` primitives                                                                                                                                   |
| `database/`                | Migrations (`migrations/`), migrate runner, seed                                                                                                                                        |
| `tests/fakes/`             | Fake job source (demo jobs), AI and e-mail used only by the automated tests                                                                                                             |

Route handlers use one of the wrappers from `src/lib/http/api.ts`: `userRoute(minRole, …)` (session cookie, role
check, same-origin check on state-changing methods) and `publicRoute` (login, logout, health); the import API uses `tokenRoute` (Bearer import token). The wrappers also attach a request id and turn
every error into the standard error JSON.

## Run lifecycle

```
POST /api/runs (Idempotency-Key)
   │  createRun: freeze the profile configuration into agent_runs.configuration_snapshot,
   │             create 7 run_stages rows, status QUEUED
   ▼
dispatchRun ── next/server after() → runInProcess (same server process)
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
fails the run if a step keeps failing. A run stuck after a crash can be resumed (`POST /api/runs/:id/resume`) once its lease
has expired. The UI follows progress by polling `GET /api/runs/:id/events` every 2 seconds.

Run statuses: `QUEUED → RUNNING → COMPLETED | COMPLETED_WITH_ERRORS | FAILED | CANCELLED | BLOCKED_SOURCE`.
Transitions are declared in `src/modules/runs/transitions.ts`; any other transition raises `INVALID_STATE`.

## Qualification

1. **Hard filters** (`src/modules/qualification`): budget minimum (exact decimal arithmetic, `$499.99` fails `$500`),
   fixed-price only, payment verification required (unknown counts as not verified), currency policy (foreign
   currency is UNKNOWN unless a fixed rate is configured), required/optional skills with aliases and word boundaries,
   include/exclude keywords, client rating/hires/spend/location, the client's hire rate (default at least 50%),
   competition on the posting (default: Upwork proposal band "10 to 15" or fewer, at most 3 freelancers interviewing,
   at most 10 invites sent, nobody hired yet; unknown counts pass), URL host checks, and "already notified to this
   recipient". These follow the team's Upwork hunting checklist; each limit is editable per profile.
   **Soft rules** (profile setting `leads.softRules`, on by default since 2026-11-26): the rules that judge a job's
   chances rather than whether it is the right work (budget, payment verification, client rating/hires/spend/hire
   rate, proposals, interviewing, invites) still record their result but no longer reject or park the job
   (`SOFT_RULES` in `hard-filters.ts`); the Potential score reflects them instead. Job type, currency, skills,
   keywords, category, location, "already hired" and "already notified" still reject.
   **Priority countries:** a client in one of the profile's preferred countries (default: USA, Canada, Australia, UK
   and European countries) is not required, but adds `ai.preferredCountryBonus` points (default 5) to the score,
   capped at 100. The bonus is stored in the qualification's evidence and shown on the job page and in the lead e-mail.
2. **AI evaluation** (`src/modules/ai`, prompt `prompts/v2.ts`, version `lead-eval-v2`): the model gets only a minimal
   profile slice, the job text, the posting's terms and hiring activity, and the client's numbers (rating, reviews,
   spend, hires, hire rate, hours, active contracts, jobs posted). The client's review comments and contract titles are
   never sent. Its output must
   match a strict schema (`output-schema.ts`); invalid output is retried within the profile's `maxRetries` and
   otherwise recorded as `AI_ERROR`. The model's own total score is ignored. The app computes the weighted score from
   the five dimension scores (integer, round half up). The prompt version and a hash of the input are stored with each
   qualification.
3. **Potential score** (`potential.ts`, no AI): 0-100 from four signals of 25 points each: competition (proposal
   band, interviews, invites, posted in the last 6 hours), client (payment verified, hire rate, total spend, rating),
   budget fit (against the profile's minimum) and long-term work (duration, workload). Unknown data scores in the
   middle. Its reasons ("Few proposals", "Client hires 80% of the time") are stored in the evidence.
4. **Lead score and tier**: `round(fit × fitWeight% + potential × (100 − fitWeight)%)` (default 60/40), plus the
   priority-country bonus, capped at 100. Hot: score ≥ `ai.minScore` (default 75), alerted. Warm: score ≥
   `ai.minScore − leads.warmBelowHot` (default 20 below), kept as a qualified lead but not alerted. Cold: below that,
   rejected. A disqualifying risk flag rejects; severe flags (per risk sensitivity) send the job to review.
   `qualifications` stores `fit_score`, `potential_score` and `tier`; `score` is the lead score.

## Notifications and delivery guarantees

Alerts are e-mails (Brevo or SMTP) to the profile's opted-in e-mail recipient
(`src/modules/notifications/channels.ts`); the same recipient gets the optional run summary and failure alert. Selection reserves at most `maxPerRun` notification rows under a
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

| Decision                                                         | Why                                                                 | Trade-off                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| One Next.js app for UI and API                                   | One deployable, shared types and validation                         | API and UI scale together                              |
| Steps are idempotent with leases                                 | Safe retries, duplicate triggers, crash recovery                    | More state per run (stages, leases)                    |
| Configuration snapshot frozen per run (DB trigger)               | Results stay explainable after profile edits                        | Snapshot duplicates profile data                       |
| Database constraints for dedup and alert uniqueness              | Correct under concurrency without application locks                 | Callers must handle unique violations (mapped to 409)  |
| Short polling (2 s) instead of SSE/WebSockets                    | Simple, works through any proxy                                     | Up to 2 s delay, one request per 2 s per open run page |
| Fakes only in tests, never an app setting                        | A deployed site can never fall back to fake jobs, scores or e-mails | Running locally needs real keys or the import flow     |
| Jobs only from the Upwork sync (official connector), no scraping | Stays within Upwork's terms; no Upwork API key needed               | Depends on the Claude cloud routine running            |

## Scalability and failure modes

- One web container handles UI, API and run execution. Runs live in the server process: a restart interrupts them,
  and they need `resume` after the lease expires.
- Discovery is capped (pages and jobs per run) and records a `DISCOVERY_LIMIT_REACHED` warning when truncated.
- AI calls are bounded by batch size and concurrency; rate limits and timeouts are classified and retried within the
  profile's limits.
- Postgres is the only stateful dependency; backups: [deployment.md](deployment.md#backups).
- Not built: horizontal scaling of in-process execution (one active run per profile is enforced, but several web
  instances would each run their own in-process jobs), queue-based workers, metrics/alerting beyond logs.
