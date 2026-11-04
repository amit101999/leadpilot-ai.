# Database

PostgreSQL 16, accessed with Drizzle ORM (`postgres` driver). Schema: `src/lib/database/schema.ts`. Migrations:
`database/migrations/`. Client and pool: `src/lib/database/client.ts` (`DATABASE_POOL_MAX`, default 10).

## Tables

| Table                     | Holds                                                                                                                            | Key constraints                                                                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                   | Accounts: email, argon2 password hash, role (`ADMIN`/`OPERATOR`/`VIEWER`), status                                                | Unique `lower(email)`                                                                                                                                                                                             |
| `sessions`                | Server-side sessions: HMAC-SHA256 hash of the token (never the token), expiry, IP, user agent                                    | Unique `token_hash`; index on `user_id`                                                                                                                                                                           |
| `notification_recipients` | Alert recipients per owner: channel `WHATSAPP` (E.164 phone) or `EMAIL` (address), label, opt-in confirmation time, archive time | Unique `(owner_user_id, channel, phone_e164)` and `(owner_user_id, channel, lower(email))`; CHECK: a WhatsApp row has a valid phone and no e-mail, an e-mail row the opposite. The API only returns masked values |
| `search_profiles`         | Profile name, owner, current version number, default flag, archive time                                                          | At most one default profile per owner (partial unique index)                                                                                                                                                      |
| `profile_versions`        | Every saved configuration (JSON validated by zod) with author and change note                                                    | Unique `(profile_id, version_number)`; **append-only** (trigger)                                                                                                                                                  |
| `agent_runs`              | A run: status, executor, idempotency key, frozen configuration snapshot, lease, counters, warnings, error summary                | Unique `(requested_by, idempotency_key)`; at most one `QUEUED`/`RUNNING` run per profile (partial unique index); **snapshot immutable** (trigger)                                                                 |
| `run_stages`              | One row per run and stage: status, attempts, metrics, error                                                                      | Unique `(run_id, stage)`                                                                                                                                                                                          |
| `jobs`                    | Normalized job postings, shared across runs: budget, client data, skills, URL, first/last seen                                   | Unique `(source, source_job_id)`, which is the deduplication key                                                                                                                                                  |
| `run_jobs`                | Which jobs a run saw, with filter results and processing status                                                                  | Unique `(run_id, job_id)`                                                                                                                                                                                         |
| `qualifications`          | AI result per run and job: dimension scores, authoritative score, decision and reasons, model, prompt version, input hash        | Unique `(run_id, job_id)`                                                                                                                                                                                         |
| `notifications`           | One alert per job, channel and recipient: status, idempotency key, provider message id, preview                                  | Unique `(job_id, channel, recipient_id)`, so a job is never alerted twice to one recipient; unique `idempotency_key`; unique provider message id                                                                  |
| `notification_attempts`   | Each send attempt with HTTP status and sanitized error                                                                           | References `notifications`                                                                                                                                                                                        |
| `audit_logs`              | Who did what: actor type and id, action, entity, before/after state, request id                                                  | Insert-only by the application                                                                                                                                                                                    |
| `integration_status`      | Last known state of each integration (database, job source, AI, WhatsApp, n8n)                                                   | Unique `provider`                                                                                                                                                                                                 |
| `rate_limits`             | Fixed-window counters; the key combines the rule name and the subject (e-mail, user id, IP)                                      | Primary key `(key, window_start)` (upserted)                                                                                                                                                                      |
| `import_tokens`           | Per-user tokens for the Upwork sync agent: name, HMAC of the token (never the token), last use, revocation time                  | Unique `token_hash`                                                                                                                                                                                               |
| `import_batches`          | One accepted import: profile, importing user, origin, received/accepted/invalid counts, the run it started (if any)              | References `search_profiles`, `users`, `agent_runs`                                                                                                                                                               |
| `staged_jobs`             | Imported jobs (validated `NormalizedJob` JSON) waiting for (`PENDING`) or taken by (`CONSUMED`) an import run                    | Partial unique `(profile_id, source, source_job_id)` where `PENDING`: a job waits at most once per profile                                                                                                        |
| `sync_state`              | Per profile: last Upwork sync time, status and sanitized error (drives the "due" schedule)                                       | Primary key `profile_id`                                                                                                                                                                                          |

Enumerations (Postgres enums): run status, run stage, stage status, job processing status, budget type, qualification
decision, notification channel and status, integration state, audit actor type. Money is stored as `numeric` and
handled as decimal strings in code (`src/lib/money/decimal.ts`), never as floating point.

## Migrations

| File                           | Contents                                                                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0000_init.sql`                | All tables, enums, indexes and foreign keys (generated by `drizzle-kit generate`)                                                                                |
| `0001_immutability_guards.sql` | Triggers: `profile_versions` rows cannot be updated or deleted; an `agent_runs` row's configuration snapshot, profile id and profile version id cannot change    |
| `0002_upwork_import.sql`       | `EMAIL` notification channel and e-mail recipients; tables `import_tokens`, `import_batches`, `staged_jobs`, `sync_state`. Additive: existing rows are unchanged |

Commands: `npm run db:generate` (new migration from schema changes), `npm run db:migrate` (`database/migrate.ts`,
idempotent, tracked in the `drizzle` schema), `npm run db:seed` (`database/seeds/seed.ts`: first admin, starter
profile and optional recipient; never resets an existing password). In Docker, the `migrate` service runs migrations
before the web app starts.

## Integrity and concurrency

- **Idempotent run creation**: the `(requested_by, idempotency_key)` unique index returns the original run for a
  repeated key; the partial unique index allows only one active run per profile (`RUN_ALREADY_ACTIVE`).
- **Leases**: a step updates `lease_owner` / `lease_expires_at` with a conditional `UPDATE`, so only one executor drives a
  run at a time; another executor gets `LEASE_HELD` until the lease (`RUN_LEASE_SECONDS`, default 300) expires.
- **Optimistic locking** on profile edits: the client sends the version it edited; a mismatch returns
  `VERSION_CONFLICT` (409).
- **Deduplication**: jobs are upserted on `(source, source_job_id)`; run links on `(run_id, job_id)` with
  `ON CONFLICT DO NOTHING`.
- **Alert uniqueness**: the `(job_id, channel, recipient_id)` index holds under concurrent runs (tested in
  `tests/integration/notifications.test.ts`).
- Any other unique violation is reported to clients as `CONFLICT` (409), never as a server error.

## Retention and cleanup

- Expired sessions are rejected on lookup and deleted on the next successful login.
- `rate_limits` rows older than a day are deleted opportunistically (about 1 in 100 increments).
- Jobs, runs, qualifications, notifications and audit logs are kept indefinitely. No retention policy is implemented;
  the operator decides when to archive or delete.
- Backups and restore: [deployment.md](deployment.md#backups).
