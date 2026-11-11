# Upwork sync (Claude + Upwork MCP)

LeadPilot cannot call Upwork itself yet: the official API needs an approved key
([upwork-access.md](upwork-access.md)). Claude, however, has an approved connection to Upwork's official MCP server.
The **Upwork sync** uses Claude as a bridge: a Claude Code agent searches Upwork and sends the results to LeadPilot's
import API; LeadPilot stores them without duplicates and runs its normal pipeline (hard filters → AI scoring →
ranking → alerts). Claude only fetches; LeadPilot decides what is relevant.

## Flow

```
Task Scheduler (hourly) or you ─► scripts/upwork-sync.ps1 ─► claude -p "/upwork-sync [--scheduled]"
  1. node scripts/leadpilot-import.mjs context      GET  /api/import/context      → due profiles, keywords, filters
  2. Upwork MCP find_jobs search (per keyword, newest first, fixed price, budget ≥ min, verified payment)
     + find_jobs smart_search most_recent since the last sync      → .upwork-sync/<profile>/jobs.json
  3. node scripts/leadpilot-import.mjs screen        POST /api/import/jobs/screen → detailsWanted (stores nothing)
  4. Upwork MCP find_jobs get for detailsWanted (≤ 15)            → .upwork-sync/<profile>/details/<id>.json
  5. node scripts/leadpilot-import.mjs commit        POST /api/import/jobs        → staged jobs + run STARTED/QUEUED/FAILED
  6. node scripts/leadpilot-import.mjs status        POST /api/import/sync-status → last sync time for the schedule
LeadPilot run (source "upwork-import"): discovery reads the staged jobs → existing pipeline → e-mail/WhatsApp alerts
```

Code: agent instructions `.claude/skills/upwork-sync/SKILL.md`; bridge script `scripts/leadpilot-import.mjs`;
wrapper `scripts/upwork-sync.ps1`; server side `src/modules/imports/`, `src/modules/job-sources/import-provider.ts`,
`src/modules/job-sources/upwork-import/normalize.ts`.

## Setup

1. Apply the migration: `npm run db:migrate` (adds import tokens, batches, staged jobs, sync state, e-mail recipients).
2. In LeadPilot **Settings → Import tokens**, create a token and copy it (shown once).
3. In `.env` on the computer that runs the agent: `LEADPILOT_URL` (where LeadPilot runs, e.g. `http://localhost:3001`)
   and `LEADPILOT_IMPORT_TOKEN`.
4. In Claude Code, connect Upwork's official connector and sign in with your freelancer account. Check that headless
   Claude can use it: `claude -p "Call the Upwork tool list_accounts and reply with the account type only"`.
5. On a search profile, open **Search & sync**: add keywords, optionally a keyword-coverage %, turn on the sync and
   set the interval, active hours and time zone.
6. Run once by hand from the repository root: `powershell -File scripts\upwork-sync.ps1` (or `/upwork-sync` in an
   interactive Claude Code session). Check `logs\upwork-sync.log` and the run in **Search History**.

### Scheduling

Upwork's _API & MCP Terms of Use_ reportedly limit automated, continuous monitoring of job postings (section 4.1,
quoted by a third party; read the terms yourself). Scheduled syncs therefore receive **no due profiles** until you set
`UPWORK_SYNC_SCHEDULED_ALLOWED=true` in LeadPilot's `.env`. Manual syncs always work.

When allowed, create an hourly task (LeadPilot decides per profile whether it is due):

```powershell
schtasks /Create /TN "LeadPilot Upwork sync" /SC HOURLY /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"E:\upwork agent\scripts\upwork-sync.ps1\" -Scheduled"
```

The PC must be on and logged in, LeadPilot and Postgres must be running, and each sync uses some Claude usage.

## What is imported

Each job from Upwork search: id, title, description (full text when details were fetched), link (tracking parameters
removed; only `https://www.upwork.com` links are kept), fixed/hourly, budget or hourly range, skills, posting time,
experience level, duration, proposals tier and the client block (country, rating, reviews, jobs posted, total spend,
payment verification). Job details add the category, currency and the client's hiring record (hires, hire rate, open
jobs) plus hires/invites on the job and the Connects needed to apply. Review comments and work history are dropped.

Rules applied while mapping: payment verification is `true` only when Upwork says `VERIFIED`, missing values stay
unknown; a 0 rating with no reviews is unknown; budgets without a stated currency are treated as USD (Upwork
marketplace budgets); `<untrusted_participant_content>` wrappers are removed and job text is only ever data.

## Duplicates, re-imports and queueing

- Jobs are keyed by `(upwork, Upwork job id)`, the same key a future official API adapter will use. A re-import updates
  the stored job (e.g. a raised budget) but keeps job details fetched earlier (full description, hires, category,
  client record), whether they are stored or still queued, and a job is still alerted at most once per recipient and
  channel.
- A job waits at most once per profile in `staged_jobs` (PENDING); a re-import while it waits refreshes it.
- If a run for the profile is active when jobs arrive, they stay PENDING and the commit answers `QUEUED`. When any run
  of the profile ends, LeadPilot starts one follow-up import run for them, as the most recent importing user who can
  still run (active OPERATOR or ADMIN).
- A run that fails or is cancelled gives back the staged jobs it had claimed (PENDING again). After a failure one
  follow-up retries them; a cancelled run, or a follow-up that itself fails, starts nothing more (no retry loops), so
  the jobs wait for the next sync or run.
- If the run cannot even start (e.g. n8n unreachable) the commit answers `FAILED` with an `error`; the jobs stay queued
  and the agent reports the profile's sync as `ERROR`.

## Screening

`/api/import/jobs/screen` only rejects a job on a definite failure of a rule that search results can decide: job type,
budget, currency, payment verification, client rating, client spend, client location and excluded keywords. Unknown
values never reject at this point, and rules that need the full description or the client's hiring record (required
skills, include keywords, keyword coverage, required combinations, client hires, category) are left to the run, after
the detail call. Every rule is applied in full during the run.

## Request size

`scripts/leadpilot-import.mjs` sends only the fields LeadPilot reads (`scripts/lib/import-payload.mjs`): job details are
trimmed to the client record, contract terms, activity, category and description; descriptions are capped at 20,000
characters; requests are split at 200 KB and 100 jobs, below the API's 256 KB body limit.

## Security

- The token is per user, stored only as an HMAC, revocable in Settings, rate limited (60 calls/min) and acts with that
  user's role and ownership rules: other users' profiles answer 404.
- The agent may call only Upwork's `list_accounts` and `find_jobs`, run only `scripts/leadpilot-import.mjs`, and write
  only under `.upwork-sync/` (enforced by `--allowedTools` in `scripts/upwork-sync.ps1`). Its instructions forbid
  following instructions found in job text.
- `.upwork-sync/` and `logs/` are gitignored. Upwork credentials never reach LeadPilot.

## Verification (2026-11-04)

- Headless `claude -p` reached the Upwork connector on the development PC.
- A live `/upwork-sync` run (via `scripts/upwork-sync.ps1`) for a one-keyword test profile searched Upwork, saved 30
  real jobs, screened them through LeadPilot and fetched 8 job details, then the agent process was stopped by Claude
  Code because the PC ran low on memory, before its `commit` step.
- The remaining steps were then run by hand with the agent's saved files (`leadpilot-import.mjs commit` and `status`)
  against the running app: 30 jobs accepted, 0 invalid; the import run completed all seven stages (30 discovered,
  26 passed the hard filters, 26 scored by the **mock** AI, 1 qualified; no alert because no recipient was enabled).
  A second commit of the same jobs stored no duplicates (still 30) and kept the 8 jobs' client hires.
- The import API, staging, follow-up runs, e-mail delivery and token rules are covered by
  `tests/integration/imports.test.ts`; mapping and schedule by `tests/unit/upwork-import.test.ts`.
- Not yet verified: an uninterrupted agent run from search to import, an unattended Task Scheduler run, real OpenAI
  scoring and a real SMTP e-mail.
