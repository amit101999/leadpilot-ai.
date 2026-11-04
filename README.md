# LeadPilot AI

LeadPilot finds freelance job postings that fit a saved search profile, filters them with strict business rules, has
an AI model score the ones that pass, and sends the best leads to WhatsApp. One person or a small team runs it: they
define what a good job looks like once, start a run (from the UI or through n8n), and get a short list of qualified
leads with the reasons behind each decision.

> **Upwork access.** LeadPilot has no direct Upwork API access yet (that needs an approved key, see
> [docs/upwork-access.md](docs/upwork-access.md)). Real Upwork jobs come in through the **Upwork sync**: a Claude Code
> agent using Upwork's official connector imports them, and LeadPilot filters, scores and alerts
> ([docs/upwork-sync.md](docs/upwork-sync.md)). Without it, runs use a mock job source.

## What works today

| Area            | Status                                                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search profiles | ✅ Create, edit (versioned, optimistic locking), duplicate, archive, restore an old version                                                                                                                             |
| Runs            | ✅ Seven idempotent stages with leases; in-process or n8n executor; cancel; live progress (2 s polling)                                                                                                                 |
| Hard filters    | ✅ Budget, fixed-price/hourly, payment verification, currency, skills/keywords, keyword coverage %, client conditions, URLs                                                                                             |
| AI scoring      | ✅ Mock evaluator; OpenAI adapter (strict JSON schema), unit-tested with mocked HTTP, not run live                                                                                                                      |
| WhatsApp alerts | ✅ Mock provider; Cloud API adapter and status webhook, unit/integration-tested, not run live                                                                                                                           |
| E-mail alerts   | ✅ Mock provider; SMTP adapter (nodemailer), unit/integration-tested, not run against a real mailbox                                                                                                                    |
| Job source      | ✅ Upwork sync (Claude + Upwork MCP → import API), import side integration-tested, live search verified, full live import not yet. ⚠️ Direct Upwork API adapter reports `NOT_AUTHORIZED` by design; mock feed for demos |
| UI              | ✅ Dashboard, Run Agent, History, Leads, All Jobs, Profiles, Notifications, Integrations, Settings, Audit                                                                                                               |
| Auth            | ✅ Email + password (argon2), server-side sessions, roles VIEWER < OPERATOR < ADMIN                                                                                                                                     |
| Deployment      | ✅ Docker Compose stack, Caddy HTTPS, Postgres backup/restore scripts (verified on Docker Desktop)                                                                                                                      |

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

Everything runs with mock providers by default (`AI_PROVIDER=mock`, `WHATSAPP_PROVIDER=mock`,
`JOB_SOURCE_PROVIDER=mock`), so no external service is called.

Full Docker stack and production: [docs/deployment.md](docs/deployment.md).

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
| `scripts/backup-db.sh` / `scripts/restore-db.sh` | Database backup and restore (Docker stack)           |

## Stack

Next.js 16 (App Router, React 19, TypeScript strict) for both UI and API · PostgreSQL 16 with Drizzle ORM · zod
validation · Tailwind CSS · pino logging · argon2 password hashing · OpenAI SDK · n8n 2.42 (optional orchestrator) ·
Vitest and Playwright · Docker Compose and Caddy.

## Documentation

| Document                                                   | Contents                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)               | Components, run lifecycle, design decisions and trade-offs |
| [docs/database.md](docs/database.md)                       | Tables, constraints, migrations, integrity guarantees      |
| [docs/api.md](docs/api.md)                                 | Every endpoint, auth rules, errors, rate limits            |
| [docs/security.md](docs/security.md)                       | Threat model, controls in place, known risks               |
| [n8n/documentation/README.md](n8n/documentation/README.md) | The n8n run workflow                                       |
| [docs/whatsapp.md](docs/whatsapp.md)                       | WhatsApp Cloud API setup, templates, delivery guarantees   |
| [docs/upwork-access.md](docs/upwork-access.md)             | Why live Upwork discovery is blocked and what unblocks it  |
| [docs/upwork-sync.md](docs/upwork-sync.md)                 | Importing real Upwork jobs through Claude + Upwork MCP     |
| [docs/deployment.md](docs/deployment.md)                   | Docker, production, backups                                |
| [docs/testing.md](docs/testing.md)                         | Test suites and acceptance-scenario mapping                |
| [docs/troubleshooting.md](docs/troubleshooting.md)         | Common problems and fixes                                  |
| [docs/progress/PROGRESS.md](docs/progress/PROGRESS.md)     | What was built in each phase, decisions and verification   |
