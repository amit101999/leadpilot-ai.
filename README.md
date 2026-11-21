# LeadPilot AI

LeadPilot finds freelance job postings that fit a saved search profile, filters them with strict business rules, has
an AI model score the ones that pass, and e-mails the best leads. One person or a small team runs it: they
define what a good job looks like once, let the Upwork sync bring in new postings, and get a short list of qualified
leads with the reasons behind each decision.

> **Where jobs come from.** LeadPilot does not search Upwork itself. Jobs come in through the **Upwork sync**: a Claude
> Code agent (a scheduled cloud routine) uses Upwork's official connector and posts the results to LeadPilot's import
> API; LeadPilot then filters, scores and alerts ([docs/upwork-sync.md](docs/upwork-sync.md)).

## What works today

| Area            | Status                                                                                                                                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search profiles | ✅ Create, edit (versioned, optimistic locking), duplicate, archive, restore an old version; one active profile per user (the one synced from Upwork); the team's hunting checklist as rules (client hire rate, proposals, interviewing, invites, already hired) and a priority-country score bonus |
| Runs            | ✅ Seven idempotent stages with leases, executed inside the app; cancel; live progress (2 s polling)                                                                                                                                                                                                |
| Hard filters    | ✅ Budget, fixed-price/hourly, payment verification, currency, skills/keywords, keyword coverage %, client conditions, URLs                                                                                                                                                                         |
| AI scoring      | ✅ OpenAI adapter (strict JSON schema), unit-tested with mocked HTTP; used in production                                                                                                                                                                                                            |
| E-mail alerts   | ✅ The only alert channel (leads, run summaries, failure alerts). SMTP (nodemailer) or Brevo HTTPS API; a real test e-mail was accepted by Gmail SMTP; production uses Brevo                                                                                                                        |
| Job source      | ✅ Upwork sync (Claude + Upwork MCP → import API) on a schedule set in Settings (every 1–24 h); import side integration-tested, live Upwork search verified; the cloud routine is paused until the next deploy                                                                                      |
| UI              | ✅ Dashboard, Run Agent, History, Leads, All Jobs, Profiles, Notifications, Integrations, Settings, Audit                                                                                                                                                                                           |
| Auth            | ✅ Email + password (argon2), server-side sessions, roles VIEWER < OPERATOR < ADMIN                                                                                                                                                                                                                 |
| Deployment      | ✅ Render (Docker image from the `Dockerfile`) + Neon Postgres + Brevo, at `https://leads.peepalx.com`                                                                                                                                                                                              |

## Quick start (development)

Requirements: Node.js 22, Docker (for Postgres).

```sh
cp .env.example .env            # then fill POSTGRES_PASSWORD, DATABASE_URL, AUTH_SECRET, SEED_ADMIN_*
npm ci
docker compose up -d postgres   # Postgres on 127.0.0.1:55432
npm run db:migrate
npm run db:seed                 # first admin + a starter profile
npm run dev                     # http://localhost:3000
```

The app has no demo mode: runs only process jobs delivered through the import API, AI scoring needs
`OPENAI_API_KEY`, and alerts need SMTP or Brevo settings. Until a service is configured, its Integrations card says
"not configured" and nothing is faked. To try it locally, create an import token on the Profiles page and run the
Upwork sync against `http://localhost:3000` ([docs/upwork-sync.md](docs/upwork-sync.md)); add OpenAI and e-mail
settings to `.env` to see scoring and alerts. The automated tests use fakes instead (`tests/fakes`), so they never
call a real service.

Production runs free on Render + Neon at `https://leads.peepalx.com` ([docs/deployment.md](docs/deployment.md)).
CI (GitHub Actions) tests every push; Render deploys `main` once those checks pass.

## Commands

| Command                                          | Purpose                                              |
| ------------------------------------------------ | ---------------------------------------------------- |
| `npm run dev` / `npm run build` / `npm start`    | Develop, build, run the production server            |
| `npm run lint` / `npm run typecheck`             | ESLint, `tsc --noEmit`                               |
| `npm run format` / `npm run format:check`        | Prettier                                             |
| `npm run db:generate` / `db:migrate` / `db:seed` | Drizzle migrations and the seed                      |
| `npm run test:unit` / `test:integration`         | Vitest (integration needs `TEST_DATABASE_URL`)       |
| `npm run test:e2e`                               | Playwright against a production build                |
| `npm run test:live`                              | Opt-in checks against real services (`LIVE_TESTS=1`) |

## Stack

Next.js 16 (App Router, React 19, TypeScript strict) for both UI and API · PostgreSQL 16 with Drizzle ORM · zod
validation · Tailwind CSS · pino logging · argon2 password hashing · OpenAI SDK · Vitest and Playwright · Docker
(production image; local Postgres through Docker Compose).

## Documentation

| Document                                               | Contents                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)           | Components, run lifecycle, design decisions and trade-offs |
| [docs/database.md](docs/database.md)                   | Tables, constraints, migrations, integrity guarantees      |
| [docs/api.md](docs/api.md)                             | Every endpoint, auth rules, errors, rate limits            |
| [docs/security.md](docs/security.md)                   | Threat model, controls in place, known risks               |
| [docs/upwork-access.md](docs/upwork-access.md)         | Future option: a direct Upwork API job source              |
| [docs/upwork-sync.md](docs/upwork-sync.md)             | Importing real Upwork jobs through Claude + Upwork MCP     |
| [docs/deployment.md](docs/deployment.md)               | Render + Neon production, CI, backups                      |
| [docs/testing.md](docs/testing.md)                     | Test suites and acceptance-scenario mapping                |
| [docs/troubleshooting.md](docs/troubleshooting.md)     | Common problems and fixes                                  |
| [docs/progress/PROGRESS.md](docs/progress/PROGRESS.md) | What was built in each phase, decisions and verification   |
