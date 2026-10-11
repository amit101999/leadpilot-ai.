# LeadPilot AI: implementation progress

Curated record of what has been built, decided and verified. Maintained by the
`project-tracker` subagent (`.claude/agents/project-tracker.md`). The raw,
automatic history is in `activity-log.md` (local, gitignored).

Last updated: 2026-10-11

## Phase status

Plan: `C:\Users\ACER\.claude\plans\clever-noodling-finch.md`.

| Phase                    | Scope                                                                | Status                                                            |
| ------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Baseline                 | Pre-existing backend core committed                                  | ✅ Done (`703761f`)                                               |
| A. Foundation            | Seed, `.env.example`, page auth proxy, CSRF check                    | ✅ Merged to `main` (`ab4b7e1`); seed verified during B1          |
| B1. API routes (part 1)  | Auth, health, profiles, recipients, runs, jobs, leads                | ✅ Merged to `main` (`0bed021`); Turbopack build verified on main |
| B2. API routes (part 2)  | Notifications, integrations, dashboard, exports, audit, n8n, webhook | ✅ Committed `2e1ea54` on `worktree-phase-b2-api`; not merged yet |
| C. UI                    | Design system, 10 dashboard sections, profile editor, run screens    | ⏳ Not started                                                    |
| D. n8n                   | Run and error workflows calling the app's internal step API          | ⏳ Not started                                                    |
| E. Infrastructure        | Dockerfile, docker-compose, Caddy, backups                           | ⏳ Not started                                                    |
| F. Tests                 | Integration and e2e suites, 17 acceptance scenarios                  | ⏳ Not started                                                    |
| G. Docs and final review | README, `docs/*.md`, full verification                               | ⏳ Not started                                                    |

## Baseline (pre-existing work, committed 2026-10-11 as `703761f`)

Existed before this tracking started. Commit authorship of that earlier work: needs developer confirmation.

- Database: Drizzle schema with 15 tables (`src/lib/database/schema.ts`), migrations `0000_init.sql`
  and `0001_immutability_guards.sql` (profile versions append-only; run configuration snapshot frozen).
- Libraries: env validation (`src/lib/configuration/env.ts`), route wrappers `userRoute` / `internalRoute` /
  `publicRoute` (`src/lib/http/api.ts`), sessions (HMAC-hashed tokens) and argon2 passwords (`src/lib/auth/`),
  HMAC, rate limit, sanitize, URL and CSV helpers (`src/lib/security/`).
- Modules: profiles (CRUD, versions, optimistic lock), run engine (7 idempotent steps with leases,
  in-process and n8n executors), qualification (hard filters, keywords, scoring, eligibility, ranking),
  AI (OpenAI and mock evaluators, prompt v1), notifications (WhatsApp Cloud and mock, claim→send→record),
  job queries, job sources (mock provider; Upwork provider intentionally returns NOT_AUTHORIZED).
- Tests: 51 unit tests.

## Housekeeping (`8ae1a20`)

- `.gitattributes` forces LF line endings (Windows checkouts were producing CRLF, which Prettier rejects).
- Prettier applied to 40 existing files: line wrapping only, no behavior change.

## Phase A: Foundation (`ab4b7e1`, merged to `main` 2026-10-11)

### Decisions (grilled with the developer and accepted, 2026-10-11)

1. Baseline commit on `main`, then work on a worktree branch.
2. Seed admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`; refuses passwords under 12 characters; argon2.
3. Seed is idempotent: never resets a password, never overwrites an edited profile.
4. Seeded WhatsApp recipient has opt-in **unconfirmed**; WhatsApp stays disabled on the profile until
   the operator confirms opt-in. Reason: WhatsApp policy requires real opt-in.
5. Required-skill match mode `ANY`. Reason: `ALL` would reject almost every real job; the AI
   skill-alignment weight (35%) judges match strength.
6. Page auth via `src/proxy.ts` (Next 16 replaced `middleware`): cookie-presence check only;
   real session validation stays server-side.
7. CSRF: state-changing user API requests need `Origin` equal to `APP_BASE_URL`; a missing Origin
   is rejected. n8n internal and webhook routes are exempt (signature-verified).
8. Seed verified against Postgres only when Docker is available.

### Implemented

- `.env.example`: every variable read by `env.ts` plus `SEED_*`, placeholders only.
- `database/seeds/seed.ts`: admin, optional recipient, "Web & Zoho Development" profile created through
  `createProfile()` with `defaultProfileConfig()` (writes version 1 and an audit row).
- `src/proxy.ts` and `src/lib/auth/login-redirect.ts`: redirect to `/login?next=…`, open-redirect-safe.
- `src/lib/security/origin.ts`, wired into `userRoute` (`src/lib/http/api.ts`).
- `src/lib/auth/cookie.ts`: cookie name in a dependency-free module, so the proxy does not load the database layer.
- Tests: `tests/unit/origin.test.ts`, `tests/unit/login-redirect.test.ts` (30 new).

### Verification (actual results)

| Check                            | Result                                            |
| -------------------------------- | ------------------------------------------------- |
| Prettier, ESLint, `tsc --noEmit` | ✅ clean                                          |
| Unit tests                       | ✅ 81/81 (also on `main` after merge)             |
| `npm audit --omit=dev`           | ✅ 0 vulnerabilities                              |
| `next build`                     | ❌ expected: no `src/app` until Phase C           |
| Seed against Postgres            | ✅ Verified during B1 (see Phase B1 verification) |

### Open items

- ~~Run the seed against Postgres~~: done in B1, run twice, idempotent.
- ~~Login route must check Origin~~: done in B1 (`assertSameOrigin`).
- Dev-only `npm audit`: 9 findings (5 high, 4 moderate) in `braces` and an old `esbuild` used by
  `drizzle-kit`; not in production code; the only fix offered is `--force` (breaking).
- `.claude/skills/*` are directory links to `.agents/skills/*` and both are committed, so
  `git status` shows 4 phantom modifications. The content is identical.

## Phase B: API routes, grilled decisions (accepted by the developer, 2026-10-11)

1. Split into B1 (auth, health, profiles, recipients, runs and progress, jobs and leads) and B2
   (notifications list/retry/test, integrations, dashboard, exports, audit, internal n8n, WhatsApp
   webhook), each reviewed and merged separately.
2. Routes are verified with integration tests against a real Postgres in Docker.
3. Uncertain WhatsApp sends (B2): every send is tagged with our notification id in
   `biz_opaque_callback_data` (confirmed in Meta's status-webhook reference), so status webhooks can
   resolve UNCERTAIN; manual retry of an UNCERTAIN send only after 15 minutes with no webhook and an
   explicit, audited operator confirmation; FAILED_RETRYABLE keeps automatic backoff.
4. Login: email and password, one generic "Invalid email or password", timing equaliser, rate limit
   per IP and per e-mail (10 per 15 minutes), Origin check, no public sign-up.
5. Run progress: `GET /api/runs/:id/events` polled about every 2 seconds.
6. CSV exports (B2) capped at 10,000 rows with `X-Export-Truncated: true`.
7. `GET /api/health` is public and returns only `{ status, database }`.

Defaults stated without objection: Postgres 16 in `docker-compose.yml` bound to `127.0.0.1`, a separate
`leadpilot_test` database, and host port 55432 (something already listens on 5432 on the developer's machine).

## Phase B1 (`5c37353` on `worktree-phase-b1-api`, not yet merged)

### Implemented

- 23 API routes under `src/app/api/`: `auth/{login,logout,me}`, `health`, `profiles` (+ `[id]`,
  `duplicate`, `archive`, `restore`, `default`, `versions`), `recipients` (+ `[id]`), `runs` (+ `[id]`,
  `cancel`, `resume`, `events`, `jobs`), `jobs` (+ `[id]`), `leads` (+ `[id]`). Handlers only validate
  input and call existing services.
- `src/modules/auth/service.ts`: login and logout.
- `assertSameOrigin()` in `src/lib/http/api.ts`, used by `userRoute`, login and logout.
- `docker-compose.yml` and `database/docker/init/01-create-test-database.sql`.
- `.env.example`: `POSTGRES_*` and `TEST_DATABASE_URL` added.
- Integration tests: `tests/integration/{setup,helpers}.ts` and `auth`, `profiles`, `recipients`, `runs` test files.
- Bug fixed: the `q.*` query helpers in `src/lib/validation/common.ts` typed every value as `unknown`
  (`single()` took a non-generic `z.ZodType`), so no route using them could compile.

### Verification (actual results)

| Check                            | Result                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seed against Postgres (Phase A)  | ✅ Run twice. First run created the admin and "Web & Zoho Development" v1 (default; 500.00 fixed; score 75; 10 alerts; payment verification required) with audit rows; second run changed nothing |
| Integration tests                | ✅ 28/28 (auth 7, health 1, profiles 9, recipients 3, runs 8)                                                                                                                                     |
| Unit tests                       | ✅ 81/81                                                                                                                                                                                          |
| Prettier, ESLint, `tsc --noEmit` | ✅ clean                                                                                                                                                                                          |
| `next build --webpack`           | ✅ 23 routes plus the proxy                                                                                                                                                                       |
| `next build` (Turbopack)         | ⚠️ Fails in the worktree only: its `node_modules` is a junction outside the project root. To run on `main` after merge                                                                            |

Integration coverage includes: generic 401, disabled user, login CSRF, 11th login attempt returns 429,
logout invalidates the session, optimistic-lock 409, server-side configuration validation, VIEWER 403,
cross-user 404 for profiles, runs, jobs and recipients (acceptance #17), CSRF on PATCH, archive and restore,
duplicate, Idempotency-Key required, a repeated key returns the same run, `RUN_ALREADY_ACTIVE`,
concurrent double submit creates one run, the run snapshot is unchanged after a profile edit (acceptance
#13 and #14), cancelling a queued run, list pagination and filter validation, and a full mock run end to
end in which every qualified lead scores at least 75, is fixed-price and has verified payment.

### Open items and risks

- `clientIp()` trusts `X-Forwarded-For`. That is correct behind the production reverse proxy, but without
  one the per-IP login limit can be bypassed; the per-e-mail limit still applies.
- The per-e-mail limit lets someone lock a known account out of login for up to 15 minutes (accepted
  trade-off of decision 4).
- `GET /api/runs/:id` returns `leaseOwner` (an internal executor id). Low sensitivity.
- The main checkout needs its own `.env` (copy `.env.example`); the generated one exists only in the worktrees.

## Phase B2 (`2e1ea54` on `worktree-phase-b2-api`, not yet merged)

### Decisions (grilling round 2, accepted by the developer 2026-10-11, "accept all")

1. Manual retry: `FAILED_RETRYABLE` any time; `FAILED_PERMANENT` allowed (re-reserved first, opt-in rechecked,
   audited); `UNCERTAIN` only after 15 minutes and an explicit confirmation; `SENT`/`DELIVERED`/`READ` never.
2. Integration checks run only on "Test connection" (rate limited); reads return the stored result, flagged stale
   after 1 hour. Database `select 1`, WhatsApp credential check, OpenAI `models.retrieve` (free), n8n `/healthz`,
   Upwork configuration only.
3. Dashboard: totals over everything the user may see (ADMIN: all), a 30-day daily series, no caching.
4. Audit log: ADMIN only.
5. WhatsApp webhook: valid `X-Hub-Signature-256` required and refused entirely without `WHATSAPP_APP_SECRET`;
   raw bodies not stored; forward-only statuses (failed after sent becomes `FAILED_PERMANENT`); unknown ids get 200.
6. WhatsApp test message: opted-in recipients only, `hello_world`, 3 per 10 minutes, audited, not stored as a notification.

### Implemented

- Services: `src/modules/notifications/{service,webhook}.ts`, `src/modules/integrations/service.ts`,
  `src/modules/dashboard/service.ts`, `src/modules/exports/{service,http}.ts`, `listAuditLogs` in
  `src/modules/audit/service.ts`, shared list schemas `src/modules/{runs,jobs}/list-query.ts`.
- Every WhatsApp send carries `biz_opaque_callback_data` = the notification's idempotency key
  (`OutboundMessage.callbackData`, `cloud-whatsapp.ts`, `delivery.ts`).
- `AiEvaluator.checkConnection()` (OpenAI and mock).
- 13 new routes (36 in total): `notifications` (+ `[id]/retry`), `runs/[id]/notifications`, `integrations/status`,
  `integrations/[provider]/check`, `integrations/[provider]/test` (only `whatsapp`), `dashboard`,
  `exports/leads.csv`, `exports/runs.csv`, `audit-logs`, `internal/runs/[id]/steps/[step]`,
  `internal/runs/[id]/fail`, `webhooks/whatsapp` (GET and POST).
- `.env.example`: webhook variables now marked as required for the webhook.

### Verification (actual results)

| Check                            | Result                                                                  |
| -------------------------------- | ----------------------------------------------------------------------- |
| Unit tests                       | ✅ 86/86 (5 new for the webhook parser)                                 |
| Integration tests                | ✅ 46/46 (18 new: notifications 9, platform 9)                          |
| Prettier, ESLint, `tsc --noEmit` | ✅ clean                                                                |
| `next build --webpack`           | ✅ 36 routes plus the proxy                                             |
| `next build` (Turbopack)         | ⏳ To run on `main` after merge (worktree `node_modules` is a junction) |

Covered: no repeat alert to the same recipient on a rerun (acceptance #7), the per-run limit (acceptance #8),
a failed send keeps the qualification and can be retried (acceptance #11), an uncertain send is not retried
early or unconfirmed (acceptance #16), cross-user 404 and VIEWER 403 on retry, webhook SENT→DELIVERED→READ with
backwards and unknown updates ignored, UNCERTAIN reconciled through `biz_opaque_callback_data` (audited),
invalid signature 401, verification handshake (wrong token and a script challenge refused), integration
statuses and checks, test message opt-in rule, dashboard totals and isolation, CSV filters, truncation header
and formula-injection escaping, audit log ADMIN-only, internal endpoints (unsigned 401, a full run driven by
signed steps, error workflow marks FAILED with the secret removed from the stored message).

Finding during testing: run summaries (`alertOnFailure`) are separate messages and are not limited by
`maxPerRun`. The mock feed ends runs as `COMPLETED_WITH_ERRORS` (scripted AI errors), so it sends one failure summary.

### Open items and risks

- A status webhook that arrives while a row is still `SENDING` is ignored (`SENDING → DELIVERED` is not an allowed
  transition). A later `read` still advances it, but if the recipient has read receipts off, the row can stay
  `SENT` although it was delivered. Not handled yet.
- UNCERTAIN reconciliation only works with the real Cloud provider, which echoes `biz_opaque_callback_data`.
- `integration_status` is shared by all users; it holds only non-secret configuration and results.

## Environment notes

- Windows 11, Node 22.17.0, Next.js 16.4.0, PostgreSQL 16 via Docker (`127.0.0.1:55432`).
- No git remote configured; nothing has been pushed.
- No OpenAI, WhatsApp or Upwork credentials; those integrations run in mock mode.
