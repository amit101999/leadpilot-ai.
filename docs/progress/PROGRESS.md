# LeadPilot AI: implementation progress

Curated record of what has been built, decided and verified. Maintained by the
`project-tracker` subagent (`.claude/agents/project-tracker.md`). The raw,
automatic history is in `activity-log.md` (local, gitignored).

Last updated: 2026-10-15

## Phase status

Plan: `C:\Users\ACER\.claude\plans\clever-noodling-finch.md`.

| Phase                    | Scope                                                                     | Status                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Baseline                 | Pre-existing backend core committed                                       | ✅ Done (`703761f`)                                                                                                   |
| A. Foundation            | Seed, `.env.example`, page auth proxy, CSRF check                         | ✅ Merged to `main` (`ab4b7e1`); seed verified during B1                                                              |
| B1. API routes (part 1)  | Auth, health, profiles, recipients, runs, jobs, leads                     | ✅ Merged to `main` (`0bed021`); Turbopack build verified on main                                                     |
| B2. API routes (part 2)  | Notifications, integrations, dashboard, exports, audit, n8n, webhook      | ✅ Merged to `main` (`41e8d95`); Turbopack build verified on main                                                     |
| C1. UI (part 1)          | Design system, app shell, login, Dashboard, Run Agent                     | ✅ Merged to `main` (`71a0b50`); Turbopack build verified on main                                                     |
| C2. UI (part 2)          | Search History and run detail, Qualified Leads, All Jobs                  | ✅ Merged to `main` (`d742e0a`); Turbopack build verified on main                                                     |
| C3a. UI (part 3a)        | Search Profiles list, editor, version history                             | ✅ Merged to `main` (fast-forward, `e650286` + docs `a82ddab`)                                                        |
| C3b. UI (part 3b)        | Notifications, Integrations, Settings (incl. change password), Audit Logs | ✅ Committed `d18e5f8` + docs `3730daf` on `worktree-phase-c3b-ops`; merge to `main` requested but not done (blocked) |
| D. n8n                   | Run workflow calling the app's internal step API, lease-safe `/fail`      | ✅ Committed `9cf72ad` on `phase-d-n8n` (stacked on C3b); not merged                                                  |
| E. Infrastructure        | Dockerfile, docker-compose, Caddy, backups                                | ✅ Committed `62d69cc` + `7e34456` on `phase-e-docker` (stacked on D); not merged                                     |
| F. Tests                 | Integration and e2e suites, 17 acceptance scenarios                       | ⏳ Not started                                                                                                        |
| G. Docs and final review | README, `docs/*.md`, full verification                                    | ⏳ Not started                                                                                                        |

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

## Phase B1 (`5c37353`, merged to `main` as `0bed021`)

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
  Phase E: in production Caddy discards client-sent `X-Forwarded-For` (verified live 2026-10-15); the local full
  stack binds `web` to `127.0.0.1`.
- The per-e-mail limit lets someone lock a known account out of login for up to 15 minutes (accepted
  trade-off of decision 4).
- `GET /api/runs/:id` returns `leaseOwner` (an internal executor id). Low sensitivity.
- The main checkout needs its own `.env` (copy `.env.example`); the generated one exists only in the worktrees.

## Phase B2 (`2e1ea54`, merged to `main` as `41e8d95`)

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

## Phase C: UI, grilled decisions (accepted by the developer 2026-10-11, "accept all")

1. Split into C1 (design system, layout, login, Dashboard, Run Agent), C2 (Search History and run detail,
   Qualified Leads, All Jobs), C3 (Profiles editor, Notifications, Integrations, Settings, Audit Logs).
2. Pages read through server components calling the services directly with the signed-in user; mutations and
   polling go through `/api/**` (CSRF, rate limits, idempotency). No new data-fetching library.
3. Visual direction: calm and data-dense, neutral surfaces, one teal accent, status colours, Inter, light default
   with a dark toggle, no gradients or decorative motion.
4. Mock data is labelled: a demo-mode banner naming each mocked integration and a "Mock source" badge on runs.
5. Profile editor (C3): tabs, one save = one version, unsaved-changes guard, shared Zod validation, live weight
   total, 409 conflict dialog.
6. Playwright Chromium downloaded; smoke tests per part, full e2e in Phase F.
7. WCAG 2.2 AA target, tables scroll inside their panel on phones, English only.

## Phase C1 (`f894985`, merged to `main` as `71a0b50`)

### Implemented

- Tokens in `src/app/globals.css`. Chart series colours were checked with the `dataviz` skill's validator:
  `#0f766e` failed the chroma floor (reads grey in a chart), so the series use `#0a9a8a`/`#2a78d6` (light) and
  `#10a594`/`#3987e5` (dark); both pairs pass every check against the real surfaces.
- Components in `src/components/ui/` (button, field, badge with `StatusBadge`, panel, dialog and sheet, time),
  `src/components/layout/` (app shell, navigation), `src/components/dashboard/` (metric strip, daily chart),
  `src/components/runs/` (funnel rail, run launcher, live run progress).
- Pages: `/login`, `/dashboard`, `/run`, `/run/[id]` (route group `src/app/(app)/` validates the session through
  `requireUser()` in `src/lib/auth/current-user.ts`).
- Browser helpers: `src/lib/http/client.ts` (`apiFetch`, `ApiError`, idempotency keys), `src/lib/ui/use-polling.ts`.
- Navigation items for C2/C3 pages are disabled with "Soon" instead of linking to 404s.
- Playwright: `playwright.config.ts`, `tests/e2e/{global-setup.ts,smoke.spec.ts}`.
- `AGENTS.md`: written by `next dev` (Next.js 16 agent rules); re-created if deleted, so committed.

### Verification (actual results)

| Check                            | Result                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| Playwright smoke tests           | ✅ 5/5 against a production build (`next build --webpack` + `next start`), 1.4 min           |
| Unit / integration tests         | ✅ 86/86, 46/46                                                                              |
| Prettier, ESLint, `tsc --noEmit` | ✅ clean                                                                                     |
| Visual review (screenshots)      | ✅ login, dashboard light/dark, run page, confirm dialog, live and finished run, phone width |
| Browser console                  | ✅ no errors in the final screenshot run                                                     |
| On `main` after merge            | ✅ `next build` (Turbopack), unit 86/86, integration 46/46, Playwright smoke 5/5             |

### Bugs found during review and fixed

- Phone width: the page was 600 px wide on a 390 px screen (grid children could not shrink below their tables) and
  panel headers squeezed titles into a narrow column. `Panel` now has `min-w-0` and a wrapping header; the smoke
  test asserts no horizontal scroll.
- Login form: a submit before React hydrated fell back to a native GET, putting email and password in the URL.
  The form now uses `method="post"`; a smoke test checks it.
- Chart load animation hid bars in early screenshots and is decorative motion; disabled.
- Copy: "1 AI errors", "Ai errors", and a noisy finalization metrics line.

### Open items

- ~~Run detail with per-job results and qualification reasons arrives with Search History (C2)~~: done in C2
  (`/history/[id]`; `/run/[id]` links there when finished).
- E2E tests run against `next dev` stalled for about 49 minutes once (on-demand compile); they now use a production build.
- Times render in the viewer's local zone; the 30-day chart uses UTC days and says so.

## Phase C2 (`880601c`, merged to `main` as `d742e0a`)

### Decisions (grilled, accepted by the developer 2026-10-12, "accept all")

1. Server-side filtering, sorting and paging with all table state in the URL; one shared `DataTable`
   (TanStack Table, manual mode).
2. Full run detail at `/history/[id]` (summary, frozen snapshot, Qualified/Rejected/Uncertain/All tabs with reasons
   and scores, alerts, stages); `/run/[id]` stays the live view and links there when the run is finished.
3. Job detail is a dedicated page `/jobs/[id]` (not a drawer), shared by Qualified Leads and All Jobs.
4. Filter bar above each table: immediate apply, 300 ms debounced search, native date inputs, "Clear filters",
   CSV export with the current filters.
5. Snapshot shown as a readable summary plus a collapsible raw JSON view.
6. "Uncertain" = Needs review, AI error, Pending AI (plus New / Source error).

### Implementation choices made during the build (not grilled)

- Date-range upper bounds: a bare `YYYY-MM-DD` "to" means the end of that UTC day (`q.endDate()` in
  `src/lib/validation/common.ts`), applied in the shared list schemas (`src/modules/{runs,jobs}/list-query.ts`) so
  pages, `/api/runs`, `/api/leads` and the CSV exports agree.
- Export links are built server-side from validated filters (`src/lib/ui/export-href.ts`), so the export endpoint
  never receives UI-only values such as `decision=any`.
- Page search params that fail validation are dropped instead of producing an error (`src/lib/validation/search-params.ts`).
- Qualified Leads defaults to decision `QUALIFIED`; "Any status" (`decision=any`) lifts the filter.
- The outcome selector on the run detail page uses toggle buttons with `aria-pressed` rather than ARIA tabs
  (tabs would also require arrow-key navigation).
- On small screens the filter bar collapses behind a "Filters (n active)" button.
- `ProfileSummary` moved to `src/components/profiles/profile-summary.tsx`, with a detailed mode used for the run snapshot.

### Implemented

- Pages: `src/app/(app)/history/page.tsx`, `history/[id]/page.tsx`, `leads/page.tsx`, `jobs/page.tsx`,
  `jobs/[id]/page.tsx`; small changes to `dashboard/page.tsx` and `run/page.tsx`.
- Components: `src/components/table/{data-table,filters}.tsx`, `src/components/history/{runs-table,run-jobs-tabs}.tsx`,
  `src/components/leads/leads-table.tsx`, `src/components/jobs/jobs-table.tsx`,
  `src/components/profiles/profile-summary.tsx`, `src/components/ui/copy-button.tsx`; `src/components/runs/run-progress.tsx`
  links to run detail; `src/components/layout/nav.ts` enables the C2 navigation items.
- Helpers: `src/lib/ui/use-url-state.ts`, `src/lib/ui/export-href.ts`, `src/lib/validation/search-params.ts`,
  `q.endDate()` in `src/lib/validation/common.ts`.
- Tests: `tests/unit/list-params.test.ts` (7 new), 2 new smoke tests in `tests/e2e/smoke.spec.ts`.

### Verification (actual results)

| Check                            | Result                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Unit tests                       | ✅ 93/93 (7 new in `tests/unit/list-params.test.ts`)                                                              |
| Integration tests                | ✅ 46/46                                                                                                          |
| Prettier, ESLint, `tsc --noEmit` | ✅ clean                                                                                                          |
| Playwright smoke tests           | ✅ 7/7 against a production build, run twice in a row (2.8 min, then 1.2 min) at the developer's request          |
| Visual review (screenshots)      | ✅ against a production server (details below)                                                                    |
| Browser console                  | ✅ no errors                                                                                                      |
| Leads CSV export                 | ✅ 200, 5 rows, not truncated                                                                                     |
| On `main` after merge            | ✅ `next build` (Turbopack), unit 93/93, integration 46/46; Playwright 7/7 on the second attempt (see note below) |

Playwright on `main`: the first attempt crashed during the webpack build (`WasmHash._updateWithBuffer ... reading 'length'`)
because of a stale webpack cache in the main checkout's `.next/cache/webpack`. Only that cache folder (275 MB) was
deleted; the second attempt passed 7/7.

New smoke tests: history → run detail Rejected tab → job detail → leads (any status) → jobs filtered by
`FILTERED_OUT`; and no horizontal scroll at 390 px on `/history`, `/leads`, `/jobs`.

Screens reviewed: history; run detail on a mock run (Qualified 5 / Rejected 10 / Uncertain 3 / All 18); rejected
reasons (budget below minimum, payment unverified/unknown, EUR without exchange rate, hourly excluded, score 74 below
75); job detail; leads; filtered jobs; phone width.

### Bugs found during review and fixed

- ESLint `react-hooks/set-state-in-effect` in the search filter: switched to adjusting state during render.
- Job detail repeated a dimension's explanation as its evidence bullet; duplicates are now hidden.
- On phones the 12 lead filters pushed results below the fold; the filters now collapse.
- The runs/leads "to" date excluded the selected day in the API and CSV export; fixed with `q.endDate()`.

### Open items

- ~~C3 (Profiles editor, Notifications, Integrations, Settings, Audit Logs) not started~~: split into C3a (profiles,
  merged `e650286`) and C3b (committed `d18e5f8`).
- The run detail notification list shows at most 100 alerts per run (no paging there yet).
- The breadcrumb on `/jobs/[id]` always says "All Jobs", even when opened from Qualified Leads.

## Phase C3: grilled decisions (accepted by the developer 2026-10-12, "accept all")

1. Split into C3a (Search Profiles list, full editor, version history) and C3b (Notifications, Integrations,
   Settings, Audit Logs), merged separately.
2. Version history shows, per version, plain-language differences from the previous version, the author, the time
   and the change note. "Restore this version" saves the old settings as a **new** version (audited); history is
   never rewritten.
3. Keyword and country lists use chip inputs (Enter to add, × to remove); skills are rows of a name plus alias chips;
   everything is keyboard usable.
4. Only recipients with confirmed opt-in can be selected in a profile; opt-in is confirmed in Settings with an
   explicit, audited statement (C3b).
5. New `POST /api/auth/password` in C3b: current password required, new password at least 12 characters, rate
   limited, signs out other sessions, audited.
6. Notifications page (C3b): Retry for failed sends; "delivery unknown" shows a disabled button with a countdown to
   15 minutes, then a dialog with a required "recipient did not receive it" checkbox; never for sent/delivered/read.
7. Audit Logs (C3b): ADMIN only, filters (action, entity type, user, dates), each entry expands to a before/after
   diff; hidden from other roles, which get not-found.
8. Integrations page (C3b): one panel per integration with status, last checked / last successful, message, "Test
   connection" (OPERATOR and above), setup instructions naming environment variables only; WhatsApp test message with
   a recipient choice and confirmation; Upwork explains why live search is blocked.

## Phase C3a (`e650286`, merged to `main` by fast-forward, docs `a82ddab`)

### Implemented

- `/profiles` list (`src/app/(app)/profiles/page.tsx`, `src/components/profiles/profile-actions.tsx`): default and
  archived badges, a one-line rule summary, "Show archived" toggle, Duplicate / Set as default / Archive (with
  confirmation) / Restore.
- `/profiles/new` and `/profiles/[id]` (`src/app/(app)/profiles/{new,[id]}/page.tsx`,
  `src/components/profiles/profile-editor.tsx`): tabbed editor (General, Skills & keywords, Budget & job type,
  Client, AI scoring, Notifications) validated with the server's `profileConfigSchema` via `zodResolver`.
  - Tabs containing errors get a red marker; server 400 field errors are mapped onto the fields.
  - Live weight total; one save = one version, with an optional change note.
  - 409 `VERSION_CONFLICT` dialog: keep editing, or discard and load the latest version; never overwrites.
  - Unsaved-changes guard on tab close and on in-app link clicks (`window.confirm`).
  - Read-only for VIEWERs and for archived profiles.
  - Only opted-in, non-archived recipients are selectable (`src/components/profiles/recipient-options.ts`).
- Version history (`src/components/profiles/version-history.tsx`): diffs from `src/modules/profiles/diff.ts`
  (`diffConfigs`; money shown with currency, recipients by masked label), author e-mail via
  `listVersionsWithAuthors` in `src/modules/profiles/service.ts`; "Restore" saves as a new version.
- New accessible primitives: `src/components/ui/{tabs,chip-input,checkbox}.tsx` (WAI-ARIA tabs with arrow keys,
  Home and End); list editors in `src/components/profiles/list-editors.tsx`.
- Navigation: Profiles enabled in `src/components/layout/nav.ts`.
- Tests: `tests/unit/profile-diff.test.ts` (4 new), `tests/e2e/profiles.spec.ts` (5 new), `tests/e2e/auth.setup.ts`
  and `tests/e2e/helpers.ts`; `tests/e2e/smoke.spec.ts` and `playwright.config.ts` changed to reuse one session;
  `.gitignore` ignores `tests/e2e/.auth/`.

### Implementation choices made during the build (not grilled)

- New profiles start from `defaultProfileConfig(null)` (the initial business defaults, editable).
- A "Run this profile" link on the profile page, in the style of the run page.
- The unsaved-changes guard intercepts in-app anchor clicks because the App Router has no route-change events.

### Verification (actual results)

| Check                            | Result                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| Unit tests                       | ✅ 97/97 (4 new in `tests/unit/profile-diff.test.ts`)                                 |
| Integration tests                | ✅ 46/46                                                                              |
| Prettier, ESLint, `tsc --noEmit` | ✅ clean                                                                              |
| Playwright                       | ✅ 13/13 (1 setup + 12 tests), 4.4 min on the final run                               |
| Visual review (screenshots)      | ✅ list; General, Skills, Budget, AI, Notifications tabs; invalid weights; phone list |
| Browser console                  | ✅ no errors                                                                          |
| `next build` (Turbopack)         | ⏳ Not recorded as run on `main` after the C3a merge; see C3b                         |

New profile e2e tests: create, edit budget, history shows $500 → $750, restore as version 3; invalid weights
(115/100) blocked with a tab marker and the API still at version 1; a stale save from a second tab gets the conflict
dialog and the other tab's version 2 is kept; the unsaved-changes prompt keeps the user on the page;
duplicate / archive / restore.

### Bugs found during review and fixed

- React Hook Form submits disabled registered fields as `undefined`. The recipient select, the WhatsApp checkbox and
  a form-wide disabled fieldset during submit would have made saves fail validation; fields are no longer disabled
  except in read-only mode.
- "Load the latest version" after a conflict would have triggered the browser's leave-page prompt; a guard flag now
  skips it.
- Exchange-rate rows are a map keyed by currency, so a second blank row would overwrite the first; adding is
  disabled while a blank row exists.
- Version diffs showed "500.00 → 750.00"; money now shows with its currency.
- The browser suite signed in 12 times per run and tripped the real login rate limit (10 per e-mail per 15
  minutes) on the 11th. Tests now sign in once in a Playwright setup project and reuse the session
  (`tests/e2e/auth.setup.ts`, saved state gitignored at `tests/e2e/.auth/`); only the sign-in/sign-out tests log in
  fresh.

### Open items

- ~~C3b (Notifications, Integrations, Settings, Audit Logs) not started~~: committed `d18e5f8` (see below).
- The unsaved-changes guard does not catch browser back/forward within the app (only tab close and link clicks).
- ~~The Settings page referenced by the Notifications tab hint arrives in C3b~~: `/settings` added in C3b.

## Phase C3b (`d18e5f8` + docs `3730daf` on `worktree-phase-c3b-ops`, not merged)

Decisions: Phase C3 decisions 4 to 8 above, confirmed in the C3b grilling (accepted by the developer, "accept all").

### Implemented

- `/notifications` (`src/app/(app)/notifications/page.tsx`, `src/components/notifications/{notifications-table,retry-button}.tsx`):
  status filter groups, message preview, Retry. `FAILED_*` can be retried any time; `UNCERTAIN` only after 15 minutes
  and a required "recipient did not receive it" confirmation (`src/modules/notifications/retry-policy.ts`).
- `/integrations` (`src/app/(app)/integrations/page.tsx`, `src/components/integrations/integration-actions.tsx`):
  stored status per provider, per-provider "Test connection", WhatsApp test message to an opted-in recipient, setup
  instructions listing environment variable names only, Upwork live search shown as blocked.
- `/settings` (`src/app/(app)/settings/page.tsx`, `src/components/settings/{change-password-form,recipients-manager,theme-choice}.tsx`):
  - Change password: new `POST /api/auth/password` (`src/app/api/auth/password/route.ts`, `src/modules/auth/service.ts`),
    VIEWER and above, current password required, new password at least 12 characters and different from the current one,
    rate limited to 5 per 15 minutes per user (`passwordChange` in `src/lib/security/rate-limit.ts`), ends the user's
    other sessions, audited as `auth.password_change`.
  - WhatsApp recipients manager: opt-in confirm / withdraw, archive.
  - Theme choice.
- `/audit` (`src/app/(app)/audit/page.tsx`, `src/components/audit/audit-table.tsx`): ADMIN only (other roles get
  not-found), filters by action, entity type, user and dates, before/after diff via `src/lib/ui/json-diff.ts`.
- Navigation: every item enabled; the "Soon" branch removed (`src/components/layout/{nav.ts,app-shell.tsx}`).
- Tests: `tests/unit/json-diff.test.ts` (4 new), `tests/integration/password.test.ts` (5 new), a regression test in
  `tests/integration/platform.test.ts`, `tests/e2e/operations.spec.ts` (5 new); `tests/e2e/smoke.spec.ts` phone
  no-scroll test now covers 8 list pages.

### Bugs found during review and fixed

- The run pipeline's `job_source` `integration_status` upsert wrote no message and never refreshed `last_success_at`.
  Fixed in `src/modules/runs/engine/discovery.ts`, with an integration regression test.
- `/notifications` scrolled horizontally on phones (`scrollWidth` 955 at 390 px): absolutely positioned cell content
  escaped the unpositioned `overflow-x-auto` wrapper. Fixed with `relative overflow-x-auto` in
  `src/components/table/data-table.tsx`, `src/app/(app)/dashboard/page.tsx` and `src/app/(app)/history/[id]/page.tsx`.
- Stale webpack cache crash (`WasmHash`, as seen on `main` in C2): browser tests now build into `.next-e2e`
  (`NEXT_DIST_DIR`, read as `distDir` in `next.config.ts`, set in `playwright.config.ts`); the folder is ignored by git,
  Prettier and ESLint and excluded in `tsconfig.json`.

### Verification (actual results, in the worktree)

| Check                            | Result                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| Prettier, ESLint, `tsc --noEmit` | ✅ clean                                                                                |
| Unit tests                       | ✅ 101/101 (4 new in `tests/unit/json-diff.test.ts`)                                    |
| Integration tests                | ✅ 52/52 (incl. 5 new in `tests/integration/password.test.ts`)                          |
| Playwright                       | ✅ 18/18 (5 new in `tests/e2e/operations.spec.ts`; phone no-scroll covers 8 list pages) |
| `next build --webpack`           | ✅ (the build used by the e2e run)                                                      |
| `next build` (Turbopack)         | ⏳ To run on `main` after merge                                                         |

### Open items

- Merge to `main`: requested by the developer on 2026-10-13 but **not done**. The session's isolation guard blocked
  git operations on the shared main checkout, so `main` is still `a82ddab`. The developer has to run the merge; Phase D
  was stacked on this branch instead (see below). Turbopack build on `main` still to run after the merge.
- Next phases: ~~D (n8n workflows)~~ committed `9cf72ad`, E (Docker), F (tests), G (docs).

## Phase D: n8n run workflow (`9cf72ad` on `phase-d-n8n`, stacked on `worktree-phase-c3b-ops`, not merged)

### Decisions (grilled, accepted by the developer 2026-10-13, "accept all")

1. Merge C3b into `main` first. Blocked (see C3b open items), so D was built on a branch stacked on C3b.
2. One orchestration-only workflow that loops over the app's signed internal step endpoint; all business logic stays
   in the app.
3. Inbound webhook protected by an n8n Header Auth credential only; no HMAC check inside n8n. Reason: a replayed
   trigger is harmless because steps are idempotent and the run lease prevents parallel execution.
4. Outbound calls signed in n8n with the Crypto node (HMAC-SHA256) over the raw body, matching the app's verification.
5. Secrets reach n8n through environment variables (`$env`, which needs `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`). Trade-off
   documented in `n8n/documentation/README.md`: every workflow on that n8n instance can read those variables.
6. Each step call retries on failure (3 tries, 5 s apart); an in-workflow error branch reports to `/fail`; a 500-step
   guard stops runaway loops. No separate Error Trigger workflow, because it does not receive the run id.
7. Verify end to end in a temporary `n8nio/n8n:2.42.7` container, plus a static JSON test of the workflow, plus docs.

### Implemented

- `n8n/workflows/leadpilot-run.json` ("LeadPilot – run pipeline"): webhook "Run requested" (Header Auth credential
  "LeadPilot webhook secret") → "Valid run id?" (UUID check before any URL is built; otherwise "Ignore invalid
  request") → loop "Build step request" → "Sign step request" (Crypto) → "Run step" → "Read step result" →
  "Run finished?" / "Too many steps?" / "Wait requested?" ("Wait before next step" honours `retryAfterMs`) → "Done".
  Error branch: "Run owned elsewhere?" (`LEASE_HELD`) → "Leave run to its owner"; otherwise "Describe failure" →
  "Sign failure report" → "Report failure" (`/api/internal/runs/:id/fail`).
- `n8n/documentation/README.md`: run flow, security, failure handling, setup (n8n env vars, app vars, credential,
  import and publish), verified behaviour.
- `.env.example`: comment naming the n8n-side variables (`LEADPILOT_APP_URL`, `LEADPILOT_INTERNAL_API_SECRET`,
  `N8N_BLOCK_ENV_ACCESS_IN_NODE`) and the webhook credential; names only.
- `assertNoOtherLeaseHolder()` in `src/modules/runs/engine/context.ts` (exported from `engine/index.ts`), called by
  `src/app/api/internal/runs/[id]/fail/route.ts` (see bug below).
- Tests: `tests/unit/n8n-workflow.test.ts` (9 new: graph connectivity, webhook path and credential, UUID check, signing,
  only step/fail endpoints, step-to-stage map, retry and error branches, loop and wait, no secrets in the JSON);
  `tests/integration/platform.test.ts` (2 new: a duplicate execution cannot fail a run another execution is driving;
  any execution may fail once the previous lease expired).

### Bug found and fixed during D

- A duplicate n8n execution for the same run gets `LEASE_HELD` from the step endpoint, took the error branch and called
  `/fail`, and `failRun` had no ownership check, so it marked a healthy run `FAILED`. Fix: `/fail` now returns 409
  `LEASE_HELD` while a different executor (`n8n:<executionId>`) holds a live lease; without an `executionId` any live
  lease blocks. The workflow also routes `LEASE_HELD` to "Leave run to its owner" instead of reporting failure.

### Verification (actual results)

| Check                            | Result                                                   |
| -------------------------------- | -------------------------------------------------------- |
| Prettier, ESLint, `tsc --noEmit` | ✅ clean                                                 |
| Unit tests                       | ✅ 110/110 (9 new in `tests/unit/n8n-workflow.test.ts`)  |
| Integration tests                | ✅ 54/54 (2 new in `tests/integration/platform.test.ts`) |
| Playwright                       | ✅ 18/18                                                 |
| Live n8n (see below)             | ✅ with the caveat below                                 |
| `next build` (Turbopack)         | ⏳ To run on `main` after merge                          |

Live checks on 2026-10-13 against a temporary `n8nio/n8n:2.42.7` container, the app as a production build on the test
database, mock providers:

- Run started from the app → `COMPLETED_WITH_ERRORS` in about 2–3 s through 8 step calls (with-errors is expected from
  the mock fixtures' scripted AI errors).
- Wrong webhook secret → 403. Non-UUID run id → ignored.
- Unknown run id → error branch → signed `/fail` passed the signature check (404 run not found).
- Duplicate trigger after completion → stops on the terminal status.
- Duplicate trigger while the lease is held → "Leave run to its owner"; the run stays `RUNNING`.

Caveat: the app build used for the live checks predates the `/fail` lease guard; the guard itself is covered by the
integration tests only.

### Open items

- Not verified: n8n crashing mid-run followed by Resume; live providers; behaviour with a wrong internal API secret.
- Known quirk: the webhook answers 200 instead of 202 in n8n 2.42.7; the app accepts any 2xx.
- Merge C3b and D into `main` (fast-forward `main` to `phase-d-n8n`), done by the developer; then the Turbopack build on `main`.
- ~~Next: Phase E (Dockerfile, compose, Caddy, backups; will add the n8n container, its env vars and the credential
  import)~~: committed `7e34456` (see below). Then F and G.

## Phase E: Infrastructure (`62d69cc` WIP 2026-10-13 + `7e34456` 2026-10-15 on `phase-e-docker`, stacked on D, not merged)

Full write-up, including the live verification table, in `docs/deployment.md`.

### Decisions and reasons

1. The production override (`docker-compose.prod.yml`) removes every published port except Caddy's, using Compose's
   `!reset` tag (needs Compose v2.24+; verified with v5.4.0). Postgres, web and n8n are reachable on the Docker
   network only.
2. The n8n editor is not published in production; the operator reaches it through an SSH tunnel to the container
   address. Reason: with `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (Phase D decision 5) anyone who can edit workflows can
   read n8n's environment, including `N8N_ENCRYPTION_KEY` and `LEADPILOT_INTERNAL_API_SECRET`.
3. HSTS `max-age=31536000` **without** `includeSubDomains`, because `APP_DOMAIN` may be an apex domain whose other
   subdomains are not served by LeadPilot.
4. Restore loads the dump into a scratch database first (a bad file changes nothing), then stops `web` and swaps the
   databases by rename in one transaction, keeping `<db>_pre_restore_<timestamp>` for rollback.
5. `n8n-data` and `caddy-data` are not backed up: the workflow and credential are re-imported by `n8n-import` on every
   start, and Caddy re-issues certificates. `.env` must be backed up separately by the operator (without
   `AUTH_SECRET` and `N8N_ENCRYPTION_KEY` a restored server cannot work as before).
6. Off-site copying of dumps is **not implemented**; documented as an operator responsibility.

### Implemented

- `Dockerfile`: stages `deps` → `build` (`npm run build`, no secrets needed at build time) → `runner` (default target;
  Next `output: "standalone"` bundle + static assets, non-root `node` user, `HEALTHCHECK` on `/api/health`) and
  `migrator` (dependencies + sources, `npm run db:migrate`, also used for the seed). Base image `node:22.23.3-alpine3.24`.
- `.dockerignore`: excludes `.git`, `.claude`, `node_modules`, build output, test artefacts, `backups`, `.env*` (except
  `.env.example`) and the local progress log/state.
- `docker-compose.yml` (project `leadpilot`): `postgres` (16.6-alpine, `127.0.0.1:${POSTGRES_PORT:-55432}`) always; with
  `--profile stack`: one-shot `migrate`, `web` (`127.0.0.1:${WEB_PORT:-3000}`, starts after `migrate` exits 0), one-shot
  `n8n-import` (builds the Header Auth credential from `N8N_WEBHOOK_SECRET` in a mode-600 temp file, imports and
  publishes `n8n/workflows/leadpilot-run.json`), and `n8n` (`n8nio/n8n:2.42.7`, `127.0.0.1:${N8N_PORT:-5678}`,
  health check on `/healthz`). Shared app variables in the `x-app-env` anchor with defaults mirroring `env.ts`.
- `docker-compose.prod.yml`: `!reset` ports on postgres/web/n8n, `APP_BASE_URL=https://${APP_DOMAIN}` for web, and
  `caddy` (`caddy:2.11.7-alpine`, ports 80/443/443-udp, volumes `caddy-data`, `caddy-config`).
- `deploy/Caddyfile`: automatic Let's Encrypt (`ACME_EMAIL`), zstd/gzip, HSTS, `Server` header removed,
  `/api/internal/*` answered 404 (second layer on top of HMAC), `reverse_proxy web:3000` with no `trusted_proxies` so a
  client-sent `X-Forwarded-For` is discarded (addresses the B1 open item about `clientIp()` trusting that header).
- `scripts/backup-db.sh`: `pg_dump --format=custom` inside the postgres container, written to a `.partial` file,
  rejected if empty, checked with `pg_restore --list`, then renamed; `umask 077`; deletes dumps older than
  `BACKUP_KEEP_DAYS` (default 14, validated as a whole number); `BACKUP_DIR` default `backups`. Cron line documented.
- `scripts/restore-db.sh`: requires `--yes`; scratch database `<db>_restore` loaded with
  `pg_restore --single-transaction --exit-on-error`; stops `web` if running (restarted by an EXIT trap); swaps by
  rename in one `psql --single-transaction`.
- `.env.example`: `WEB_PORT`, `N8N_PORT`, `N8N_ENCRYPTION_KEY`, `APP_DOMAIN`, `ACME_EMAIL` (names and comments only).
- `docs/deployment.md` (new): services, ports, production setup, updating, n8n editor access, backups and restore,
  security notes, verification, troubleshooting. `n8n/documentation/README.md` points to it for the Docker setup.
- `package-lock.json` changed in `62d69cc` (entries added/removed, for example nested `ajv`, `picomatch`, `@emnapi/*`).
  Reason for the lockfile change: needs developer confirmation (commit message does not say).

### Verification (actual results)

| Check                                        | Result                                                                             |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| Prettier `format:check`, ESLint, `tsc`       | ✅ clean / exit 0 / exit 0 (after the last change)                                 |
| Unit tests                                   | ✅ 110/110                                                                         |
| Integration tests                            | ✅ 54/54                                                                           |
| `sh -n` on both scripts                      | ✅ OK                                                                              |
| ShellCheck                                   | ⏳ Not run (not installed)                                                         |
| `next build`                                 | ✅ inside the Docker image build (`runner` target)                                 |
| Live Docker stack (2026-10-15, listed below) | ✅ all checks in the `docs/deployment.md` "Verification (2026-10-15)" table passed |

Live checks on Windows 11, Docker Desktop (Engine 29.7.2, Compose v5.4.0), isolated Compose project, throwaway secrets,
mock providers, `RUN_EXECUTOR=n8n`; Caddy on `127.0.0.1:8080/8443` with `APP_DOMAIN=localhost` (Caddy local CA,
because port 80 was taken):

- Images build; `migrate` and `n8n-import` exit 0; `web`, `n8n`, `postgres` healthy. Seed via the `migrate` image works.
- Run started over the API and executed by n8n: `COMPLETED_WITH_ERRORS` in 2–3 s, all 7 stages completed (expected with
  mock fixtures).
- Production override: only Caddy publishes ports (web and n8n host ports refuse connections).
- HTTP → HTTPS 308; HSTS present, `Server` removed; `POST /api/internal/...` through Caddy → 404; login and run over
  HTTPS with a `Secure` session cookie; spoofed `X-Forwarded-For` / `X-Real-IP` ignored (real peer address recorded).
- Backup → change data → restore: data back to the backup state, app healthy, a run completed afterwards. Corrupt dump
  rejected with live data unchanged; restore without `--yes` refused.

Not run in this phase: Playwright.

### Incident during the phase

Drive C: filled up during image builds; Docker Desktop's data disk went read-only and the engine hung (this is why
`62d69cc` was committed as unverified WIP). Recovered by freeing space, killing the Docker processes and running
`wsl --shutdown`; data intact. A copy of Docker's data disk was saved at `E:\docker-disk-backup\docker_data-2026-10-13.vhdx`
(8.43 GB) and **has not been deleted**; it can be removed once the developer no longer needs it. Recorded as a
troubleshooting note in `docs/deployment.md`.

### Open items

- Not verified: a real Let's Encrypt certificate on a public domain, a Linux host, behaviour after a host reboot, the
  cron schedule, n8n crashing in the middle of a run.
- Off-site copy of backups not implemented.
- On Docker Desktop all requests reach Caddy from the gateway address, so login rate limiting shares one per-IP bucket
  there; on Linux clients keep their real addresses (documented, not verified on Linux).
- A restore brings back the sessions that existed at backup time; restoring a dump from a newer app version is not
  supported (documented in `docs/deployment.md`).
- Delete `E:\docker-disk-backup\docker_data-2026-10-13.vhdx` when no longer needed (developer decision).
- Merge C3b, D and E into `main` (fast-forward `main` to `phase-e-docker`), to be done by the developer; `main` is
  still `a82ddab` as of this update. Then the Turbopack build on `main`.
- Next: Phase F (tests) and Phase G (docs and final review).

## Environment notes

- Windows 11, Node 22.17.0, Next.js 16.4.0, PostgreSQL 16 via Docker (`127.0.0.1:55432`).
- Docker Desktop: Engine 29.7.2, Compose v5.4.0 (Phase E verification). Image builds need several GB free on C:.
- No git remote configured; nothing has been pushed.
- No OpenAI, WhatsApp or Upwork credentials; those integrations run in mock mode.
- Port 3000 on the developer's machine was in use by the developer's own `next` server (started from the main
  checkout on 2026-10-11 22:11) and was left running. C2 previews used port 3200 with `APP_BASE_URL` overridden to
  match, because the Origin check requires it.
