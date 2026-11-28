# Testing

Four suites. No suite calls a real job source, AI model or mail server without an explicit opt-in: they use the fakes
in `tests/fakes` (a demo job feed with scripted scenarios, a deterministic AI and an e-mail recorder). The integration
setup installs them for every test file; the Playwright server loads them with `E2E_FAKE_PROVIDERS=1`, which the app
refuses unless `APP_BASE_URL` is a localhost address. The app itself has no fake option.

| Suite       | Command                    | Runner                        | Needs                                | Count (2026-11-28)          |
| ----------- | -------------------------- | ----------------------------- | ------------------------------------ | --------------------------- |
| Unit        | `npm run test:unit`        | Vitest, project `unit`        | nothing                              | 236 tests                   |
| Integration | `npm run test:integration` | Vitest, project `integration` | Postgres and `TEST_DATABASE_URL`     | 99 tests                    |
| End to end  | `npm run test:e2e`         | Playwright (Chromium)         | Postgres and `TEST_DATABASE_URL`     | 20 tests                    |
| Live        | `npm run test:live`        | Vitest, project `live`        | `LIVE_TESTS=1` plus real credentials | 3 tests, skipped by default |

`npm run test:all` runs every Vitest project (live tests stay skipped) and then Playwright.

GitHub Actions ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs format check, lint, typecheck, unit,
integration and e2e tests plus the production build on every pull request and push to `main`, each test suite with its
own Postgres 16 service container and throwaway secrets. Live tests never run in CI. Render deploys `main` only after
these checks pass ([deployment.md](deployment.md)).

## Setup

1. `docker compose up -d postgres`. On first start, `database/docker/init` also creates the `leadpilot_test`
   database.
2. In `.env`, set `TEST_DATABASE_URL` to that database. It must differ from `DATABASE_URL`: the integration and e2e
   suites truncate every table in it (both refuse to start otherwise).

## Unit tests (`tests/unit`)

Pure functions, no database or network:

- Hard filters: budget boundaries, hourly rule, payment verification, currency policy, skills and keywords, client
  conditions, source and URL checks (`hard-filters.test.ts`).
- Authoritative scoring, eligibility thresholds, AI output schema, ranking and profile validation
  (`scoring-eligibility.test.ts`).
- Money, state machines, CSV formula-injection protection, URL validation and error redaction
  (`primitives.test.ts`).
- Lead and run-summary e-mail content: field order, hourly rates, one-line values (`lead-message.test.ts`); HTML
  escaping, safe links and SMTP outcome classification (`email.test.ts`).
- The OpenAI adapter with an injected `fetch`: request shape (`store: false`, strict JSON schema), rate-limit /
  server-error / timeout classification and connection states (`openai-evaluator.test.ts`), plus mapping of the
  response's token usage and HTTP status.
- AI cost estimation: cached and uncached input, reasoning tokens not double-billed, rounding, dated snapshots, unknown
  models return no price (`ai-pricing.test.ts`); the usage ledger never throws when its insert fails
  (`usage-ledger.test.ts`); dollar formatting of micro-USD amounts (`format-micro-usd.test.ts`).
- The `E2E_FAKE_PROVIDERS` start-up guard (`instrumentation.ts`), environment settings (`env.test.ts`), CSRF origin
  check, login redirects, list parameters, audit and profile diffs.

## Integration tests (`tests/integration`)

`setup.ts` points the app at `TEST_DATABASE_URL`, applies the migrations and truncates every table once per file. Files
run one at a time. Tests call the route handlers directly (`helpers.ts`: `call`, `createUser`) and drive runs with
`runInProcess`. The real dispatcher is mocked because it needs a live request scope. A test can replace a provider for
itself with `setProvidersForTesting` (for example a scripted feed from `tests/fakes/mock-fixtures.ts`).

Covered: authentication and sessions, password change, profiles (versions, optimistic locking, archive, duplicate),
recipients, runs (idempotency, concurrent double submit, snapshot, cancel, end-to-end run with the fakes), the run pipeline
(blocked source, deduplication), e-mail notifications (limits, reruns, concurrency, failures, uncertain sends, the run
summary e-mail, refusal of non-e-mail recipients), integrations, dashboard, exports, audit log, run leases, the Upwork
import API, the database's own immutability guards, and the AI usage ledger (one row per attempt through retries,
timeouts and invalid output; totals, fake-provider exclusion, per-owner scoping and viewer denial in
`ai-usage.test.ts`).

## End-to-end tests (`tests/e2e`)

Playwright builds the app (`next build --webpack`, then `next start` on port 3100) against `TEST_DATABASE_URL`, which
`global-setup.ts` migrates, truncates and seeds with an admin and an operator. Runs use the test fakes
(`E2E_FAKE_PROVIDERS=1`).

Covered: sign-in and sign-out, profiles (create, budget edit with version history, weight validation, stale-save
protection, unsaved-changes prompt, duplicate / archive / restore), running the agent and watching it finish, history,
run and job detail, leads and all jobs, recipient opt-in and alerts, the alert limit and no repeat alerts on a rerun,
integrations, the audit log and its access rule, password change, and phone-width layout.

## Live tests (`tests/live`)

Skipped unless `LIVE_TESTS=1` **and** the service's credentials are in `.env`:

```sh
LIVE_TESTS=1 npm run test:live                    # bash
$env:LIVE_TESTS=1; npm run test:live              # PowerShell
```

- OpenAI: the key and model are accepted, and one sample evaluation passes the strict output schema (one small paid
  request).
  Not yet run against real services. Separately, the OpenAI key was checked with one request, and the Gmail SMTP login
  and a test e-mail were checked from the Integrations page.

## Acceptance scenarios

The original specification lists 17 acceptance scenarios. The repository does not contain that list. Scenarios #7, #8,
#11, #13, #14, #16 and #17 are numbered in earlier test names. The other ten below were inferred from the
implementation plan. **Their numbering and exact wording need developer confirmation**, so they are listed by
behaviour.

| #   | Scenario                                                                                                      | Test                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 7   | A rerun never alerts the same recipient about the same job again                                              | integration `notifications.test.ts` › sends qualified leads once…; e2e › the alert limit holds, and a rerun…             |
| 8   | No more alerts than the per-run limit                                                                         | integration `notifications.test.ts` › never sends more than the per-run limit; e2e › the alert limit holds…              |
| 11  | A failed send keeps the qualification and can be retried manually                                             | integration `notifications.test.ts` › keeps the qualification when a send fails…                                         |
| 13  | Editing a profile does not change a run that already started                                                  | integration `runs.test.ts` › keeps the run's configuration snapshot…; `database-guards.test.ts`                          |
| 14  | A run records the profile version it used                                                                     | integration `runs.test.ts` › keeps the run's configuration snapshot…; `database-guards.test.ts`                          |
| 16  | An uncertain send is not retried early or without confirmation                                                | integration `notifications.test.ts` › does not retry an uncertain send early…                                            |
| 17  | Users cannot see or change other users' data (404)                                                            | integration `profiles.test.ts`, `runs.test.ts`, `notifications.test.ts`, `recipients.test.ts`                            |
| ?   | A $499 budget is rejected and exactly $500 is accepted                                                        | unit `hard-filters.test.ts` › rejects a $499 budget and accepts exactly $500                                             |
| ?   | Hourly jobs are rejected under the fixed-price rule                                                           | unit `hard-filters.test.ts` › rejects hourly jobs under the fixed-price-only rule                                        |
| ?   | Unknown payment verification does not pass                                                                    | unit `hard-filters.test.ts` › treats unknown payment verification as not passing                                         |
| ?   | Score 74 is rejected and 75 qualifies                                                                         | unit `scoring-eligibility.test.ts` › rejects a score of 74 / qualifies a score of exactly 75                             |
| ?   | The AI cannot override failed hard filters, and invalid AI output never qualifies                             | unit `scoring-eligibility.test.ts` › cannot be bypassed by a perfect AI score… / never qualifies when…                   |
| ?   | Invalid or fabricated job URLs are rejected                                                                   | unit `hard-filters.test.ts` › rejects an unauthorized source and invalid or fabricated URLs; `primitives.test.ts`        |
| ?   | Ties in ranking are broken deterministically                                                                  | unit `scoring-eligibility.test.ts` › orders by score, then discovery time, then source id                                |
| ?   | The same job delivered twice is stored once                                                                   | integration `pipeline.test.ts` › deduplicates jobs within a run and across runs…                                         |
| ?   | A job source without access ends the run as `BLOCKED_SOURCE`                                                  | integration `pipeline.test.ts` › blocks the run when the job source is not authorized…                                   |
| ?   | Alert reservation: 15 eligible with limit 10 sends 10; 3 eligible sends 3; concurrent runs never double-alert | integration `notifications.test.ts` › reserves exactly the limit… / sends every lead… / never alerts the same job twice… |

## Upwork sync and e-mail (Phase H)

- Unit: `upwork-import.test.ts` (MCP → job mapping on a recorded real Upwork response, untrusted-text and tracking-link
  removal, money parsing, staged-payload round trip, schedule time zones and windows), `email.test.ts` (HTML escaping,
  header-safe subject, SMTP outcome classification, SMTP provider with an injected transport), keyword coverage in
  `hard-filters.test.ts`.
- Integration: `imports.test.ts` (token creation/listing/revocation and auth, cross-user 404, screening stores nothing,
  commit → import run with correct mapping, dedup and update on re-import keeping earlier details, queueing with a
  follow-up run, e-mail alert sent once, sync status with secret scrubbing, scheduled-sync gate).
- E2E: the full Playwright suite passes (19/19, 2026-11-07); the recipient test now selects the "Name" field by exact
  label because Settings also has a "Token name" field.
- Not yet run: an uninterrupted live sync from search to import (the first was stopped by the OS before its import
  step; see [upwork-sync.md](upwork-sync.md#verification-2026-11-04)).

## Not covered

- Live OpenAI scoring and lead e-mails inside an automated test (they are checked in production instead).
- The server restarting in the middle of a run and resuming (the lease logic is covered by integration tests only).
- Production infrastructure (Render, Neon): see `docs/deployment.md`.
