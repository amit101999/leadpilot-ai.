# LeadPilot AI: implementation progress

Curated record of what has been built, decided and verified. Maintained by the
`project-tracker` subagent (`.claude/agents/project-tracker.md`). The raw,
automatic history is in `activity-log.md` (local, gitignored).

Last updated: 2026-10-12

## Phase status

Plan: `C:\Users\ACER\.claude\plans\clever-noodling-finch.md`.

| Phase                    | Scope                                                                     | Status                                                                  |
| ------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Baseline                 | Pre-existing backend core committed                                       | ✅ Done (`703761f`)                                                     |
| A. Foundation            | Seed, `.env.example`, page auth proxy, CSRF check                         | ✅ Merged to `main` (`ab4b7e1`); seed verified during B1                |
| B1. API routes (part 1)  | Auth, health, profiles, recipients, runs, jobs, leads                     | ✅ Merged to `main` (`0bed021`); Turbopack build verified on main       |
| B2. API routes (part 2)  | Notifications, integrations, dashboard, exports, audit, n8n, webhook      | ✅ Merged to `main` (`41e8d95`); Turbopack build verified on main       |
| C1. UI (part 1)          | Design system, app shell, login, Dashboard, Run Agent                     | ✅ Merged to `main` (`71a0b50`); Turbopack build verified on main       |
| C2. UI (part 2)          | Search History and run detail, Qualified Leads, All Jobs                  | ✅ Merged to `main` (`d742e0a`); Turbopack build verified on main       |
| C3a. UI (part 3a)        | Search Profiles list, editor, version history                             | ✅ Committed `e650286` on `worktree-phase-c3a-profiles`; not merged yet |
| C3b. UI (part 3b)        | Notifications, Integrations, Settings (incl. change password), Audit Logs | ⏳ Not started                                                          |
| D. n8n                   | Run and error workflows calling the app's internal step API               | ⏳ Not started                                                          |
| E. Infrastructure        | Dockerfile, docker-compose, Caddy, backups                                | ⏳ Not started                                                          |
| F. Tests                 | Integration and e2e suites, 17 acceptance scenarios                       | ⏳ Not started                                                          |
| G. Docs and final review | README, `docs/*.md`, full verification                                    | ⏳ Not started                                                          |

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
  committed `e650286`) and C3b (not started).
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

## Phase C3a (`e650286` on `worktree-phase-c3a-profiles`, not yet merged)

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
| `next build` (Turbopack)         | ⏳ To run on `main` after merge                                                       |

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

- C3b (Notifications, Integrations, Settings, Audit Logs) not started.
- The unsaved-changes guard does not catch browser back/forward within the app (only tab close and link clicks).
- The Settings page referenced by the Notifications tab hint arrives in C3b.

## Environment notes

- Windows 11, Node 22.17.0, Next.js 16.4.0, PostgreSQL 16 via Docker (`127.0.0.1:55432`).
- No git remote configured; nothing has been pushed.
- No OpenAI, WhatsApp or Upwork credentials; those integrations run in mock mode.
- Port 3000 on the developer's machine was in use by the developer's own `next` server (started from the main
  checkout on 2026-10-11 22:11) and was left running. C2 previews used port 3200 with `APP_BASE_URL` overridden to
  match, because the Origin check requires it.
