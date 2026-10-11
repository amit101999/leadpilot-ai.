# LeadPilot AI: implementation progress

Curated record of what has been built, decided and verified. Maintained by the
`project-tracker` subagent (`.claude/agents/project-tracker.md`). The raw,
automatic history is in `activity-log.md` (local, gitignored).

Last updated: 2026-10-11

## Phase status

Plan: `C:\Users\ACER\.claude\plans\clever-noodling-finch.md`.

| Phase                    | Scope                                                                 | Status                                                           |
| ------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Baseline                 | Pre-existing backend core committed                                   | ✅ Done (`703761f`)                                              |
| A. Foundation            | Seed, `.env.example`, page auth proxy, CSRF check                     | ✅ Merged to `main` (`ab4b7e1`). One item unverified (see below) |
| B. API routes            | All `/api/**` handlers, login, internal n8n, WhatsApp webhook, health | ⏳ Not started                                                   |
| C. UI                    | Design system, 10 dashboard sections, profile editor, run screens     | ⏳ Not started                                                   |
| D. n8n                   | Run and error workflows calling the app's internal step API           | ⏳ Not started                                                   |
| E. Infrastructure        | Dockerfile, docker-compose, Caddy, backups                            | ⏳ Not started                                                   |
| F. Tests                 | Integration and e2e suites, 17 acceptance scenarios                   | ⏳ Not started                                                   |
| G. Docs and final review | README, `docs/*.md`, full verification                                | ⏳ Not started                                                   |

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

| Check                            | Result                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| Prettier, ESLint, `tsc --noEmit` | ✅ clean                                                                             |
| Unit tests                       | ✅ 81/81 (also on `main` after merge)                                                |
| `npm audit --omit=dev`           | ✅ 0 vulnerabilities                                                                 |
| `next build`                     | ❌ expected: no `src/app` until Phase C                                              |
| Seed against Postgres            | ⚠️ **Not verified**: Docker Desktop not running. Input validation verified manually. |

### Open items

- Run the seed against Postgres (twice, to confirm idempotency) once Docker Desktop is running.
- Phase B: the login route (`publicRoute`) must call `isAllowedRequestOrigin` explicitly (login CSRF).
- Dev-only `npm audit`: 9 findings (5 high, 4 moderate) in `braces` and an old `esbuild` used by
  `drizzle-kit`; not in production code; the only fix offered is `--force` (breaking).
- `.claude/skills/*` are directory links to `.agents/skills/*` and both are committed, so
  `git status` shows 4 phantom modifications. The content is identical.

## Environment notes

- Windows 11, Node 22.17.0, Next.js 16.4.0, PostgreSQL via Docker (not yet running).
- No git remote configured; nothing has been pushed.
- No OpenAI, WhatsApp or Upwork credentials; those integrations run in mock mode.
