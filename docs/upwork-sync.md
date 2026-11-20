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
LeadPilot run (source "upwork-import"): discovery reads the staged jobs → existing pipeline → e-mail alerts
```

Code: agent instructions `.claude/skills/upwork-sync/SKILL.md`; bridge script `scripts/leadpilot-import.mjs`;
wrapper `scripts/upwork-sync.ps1`; server side `src/modules/imports/`, `src/modules/job-sources/import-provider.ts`,
`src/modules/job-sources/upwork-import/normalize.ts`.

## Job source setting

Set `JOB_SOURCE_PROVIDER=import` where LeadPilot runs in production (already in `render.yaml`). Then every run,
including **Run now** on a profile, processes only the jobs the sync delivered for that profile and finds none when
nothing was delivered. With the default `mock`, manual runs use built-in demo jobs (links to `example.com`), which are
for development and tests only: in production they would be scored by the real AI and could trigger real e-mails.
Import runs (started by `commit`) always read the staged jobs, whatever this setting says.

## Setup

1. Apply the migration: `npm run db:migrate` (adds import tokens, batches, staged jobs, sync state, e-mail recipients).
2. In LeadPilot **Settings → Import tokens**, create a token and copy it (shown once).
3. In `.env` on the computer that runs the agent: `LEADPILOT_URL` (where LeadPilot runs, e.g. `http://localhost:3001`,
   or `https://leads.example.com` when deployed, see [deployment.md](deployment.md#cloudflare-tunnel)) and
   `LEADPILOT_IMPORT_TOKEN` (created on that same LeadPilot instance).
4. In Claude Code, connect Upwork's official connector and sign in with your freelancer account. Check that headless
   Claude can use it: `claude -p "Call the Upwork tool list_accounts and reply with the account type only"`.
5. Make the profile to sync **active** (Search Profiles → **Make active**; only one profile is active at a time) and
   add its keywords in **Search & sync**. Set the timing once in **Settings → Sync scheduler**: on/off, every 1, 2, 3,
   4, 6, 8, 12 or 24 hours, active hours and time zone.
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

**Active profile.** Each user has **one active profile** (`search_profiles.active`, a unique index guarantees at most
one). **Make active** on a profile makes every other profile of that user inactive. Only the active profile is synced
from Upwork: the context lists it alone, and imports into any other profile are refused. Inactive profiles can still be
opened, edited and run by hand. A new profile becomes active only when its owner has none; a duplicate starts inactive;
archiving the active profile leaves none (the sync stops), and a restored profile comes back inactive.

**How the schedule works.** The agent (the cloud routine below, or the PC task) wakes **every hour**. On each wake-up
LeadPilot answers whether the active profile is due (`syncDue`, `src/modules/imports/schedule.ts`): scheduler on,
keywords set, inside the active hours, and the interval passed since the last sync attempt. The timing comes from the
user's **sync scheduler** (`sync_schedules`, **Settings → Sync scheduler**, `GET`/`PUT /api/sync-schedule`): every
**1, 2, 3, 4, 6, 8, 12 or 24 hours**, never more often than hourly, active hours and time zone. It belongs to the user,
not to a profile, so it stays as set until changed there, whichever profile is active. A user who never saved it gets
on, every 4 hours, 00:00–23:59 UTC. Because the agent wakes hourly, a change applies at the next hour; nothing has to
change on claude.ai. (Profiles saved before 2026-11-20 kept these settings per profile; migration 0005 copied the
active profile's settings into the scheduler, and the old fields are no longer read.)

**Scan window.** Each due profile gets a `window` in the context: from the end of its last _successful_ sync
(`sync_state.window_end`) minus a 30-minute overlap (Upwork lists a job a few minutes after its posting time), or its
interval back from now when it never synced, at most 24 hours back, up to now. The agent searches newest first and
stops paging at jobs older than `window.from`, asks Upwork's feed for exactly that window, and reports
`status ... OK --window-end <window.to>`. Only `OK` and `PARTIAL` move the window; `ERROR` leaves it, so the next sync
scans the missed period again.

**In the UI.** The profile page shows an **Upwork sync schedule** panel: the scheduler's interval and hours, whether
this profile is active, the last sync with its status and any problem, the posting time jobs were scanned up to, and
when the next sync is due. When the active profile has not been synced for 75 minutes past its due time, the panel (and
the profile list) warns that the sync agent is not checking in: the Claude cloud routine is probably paused or failing.

## Running the sync in the cloud (production setup)

Instead of a PC with Claude Code, the same agent can run as a **scheduled cloud agent (routine) of Claude Code on the
web**: Anthropic's cloud clones this repository every hour, runs `/upwork-sync --scheduled` with the Upwork connector of
your claude.ai account, and calls LeadPilot's public import API with an import token. Nothing Claude-related is
installed on the LeadPilot server, and no PC has to stay on.

```
Claude cloud routine (hourly) ─► clone repo ─► /upwork-sync --scheduled
   ├─ Upwork connector (your claude.ai account) ─► find_jobs
   └─ node scripts/leadpilot-import.mjs ─HTTPS + Bearer import token─► https://leads.peepalx.com/api/import/*
                                                                         (Render → LeadPilot)
```

The import script needs no `npm install` (Node built-ins only, Node ≥ 22.12), reads `LEADPILOT_URL` and
`LEADPILOT_IMPORT_TOKEN` from the environment, and refuses to send the token to a plain `http://` address other than
`localhost`, `127.0.0.1` or `[::1]` (`scripts/lib/leadpilot-url.mjs`).

Setup (LeadPilot runs on Render at `https://leads.peepalx.com`, see [deployment.md](deployment.md)):

0. On claude.ai: connect GitHub (`/web-setup` in Claude Code, or claude.ai/connect-github) so the cloud can clone
   this repository, and add the Upwork connector under **Customize → Connectors**. Routines can only use claude.ai
   connectors, not MCP servers configured locally in Claude Code. (Both connected and available to routines on 2026-11-17.)
1. On the live site, **Settings → Import tokens**: create a token used only by the routine (e.g. named
   `cloud-routine`), so it can be revoked on its own.
2. In the cloud environment of Claude Code on the web: set `LEADPILOT_URL=https://APP_DOMAIN` and
   `LEADPILOT_IMPORT_TOKEN` as environment variables, and allow outbound network access to `APP_DOMAIN`.
3. Check, with a one-off cloud run on this repository, that the Upwork connector is available there
   ("Call the Upwork tool list_accounts and reply with the account type only") and that
   `node scripts/leadpilot-import.mjs context` answers. Continue only if both work.
4. Create the routine (Claude Code `/schedule`): hourly, this repository and branch, prompt `/upwork-sync --scheduled`,
   tools limited to Upwork `list_accounts` and `find_jobs`, `Bash(node scripts/leadpilot-import.mjs:*)` and file
   access under `.upwork-sync/` (the same list as `scripts/upwork-sync.ps1`).
5. Set `UPWORK_SYNC_SCHEDULED_ALLOWED=true` on the server only after reading Upwork's terms (see
   [Scheduling](#scheduling)); until then every scheduled run answers "Nothing due". Decided 2026-11-17: on
   (`render.yaml`).

Differences from the PC setup: there is no lock file, so two runs could overlap if one takes over an hour; LeadPilot
already deduplicates jobs and queues imports while a run is active (`QUEUED`), so an overlap wastes Claude usage but does
not create duplicates. The `.upwork-sync/` files live only in the temporary cloud copy. If Cloudflare Access protects the
site, the `api/import` bypass in [deployment.md](deployment.md#optional-cloudflare-access) is required.

**Status (2026-11-17):** GitHub and the Upwork connector are available to routines; an end-to-end cloud run has not
been verified yet. The PC setup above remains the fallback.

## What is imported

Each job from Upwork search: id, title, description (full text when details were fetched), link (tracking parameters
removed; only `https://www.upwork.com` links are kept), fixed/hourly, budget or hourly range, skills, posting time,
experience level, duration, workload (full/part time), featured flag, proposals tier, the posting's hiring activity
(invites, interviews, offers, hires) and the client block (country, rating, reviews, jobs posted, total spend, payment
verification).

The job-detail call (`find_jobs get`) adds:

- **Job** (columns on `jobs`): category and subcategory, contract experience level, freelancers to hire, hourly rate
  range or fixed budget and currency, the hiring funnel, posting status, Connects needed to apply and the client's
  preferred qualifications. `details_fetched_at` records when.
- **Client** (one row per Upwork client in `clients`, keyed by Upwork's client company id, linked from `jobs.client_id`):
  country, state, time zone, rating and review count, total spend, hires, jobs with hires, active contracts, hours
  paid, jobs posted, open jobs, hire rate, plus up to 5 recent reviews (comments capped at 2,000 characters), up to 5
  open and 5 closed contracts from the work history and up to 5 other open jobs. Every later detail call for any job of
  that client refreshes the row.

The reviews, contract titles and other job titles are text written by third parties: they are shown on the job page as
plain text and are **never sent to the AI model**, which only receives the client's numbers. Anything else in the
detail response is dropped; in particular `attachments`, whose links carry temporary signed S3 credentials, is never
sent to LeadPilot or stored.

Rules applied while mapping: payment verification is `true` only when Upwork says `VERIFIED`, missing values stay
unknown; a 0 rating with no reviews is unknown; the detail call's client figures win over the search row's (they are
read live); hourly ranges are read from the contract terms, or from the search budget text ("10.00–20.00/hr", either
dash); budgets without a stated currency are treated as USD (Upwork marketplace budgets);
`<untrusted_participant_content>` wrappers are removed and job text is only ever data.

## Duplicates, re-imports and queueing

- Jobs are keyed by `(upwork, Upwork job id)`, the same key a future official API adapter will use.
- **A job a profile has already processed is never imported, screened, AI-scored or alerted again by that profile's
  sync**, even if it reappears in search results (`alreadySeen` in the screen and commit responses). Jobs posted before
  the profile's scan window are dropped too (`outsideWindow`). Each import run therefore holds only jobs that are new
  in the latest window, and alerts cover only those. Another profile still sees the job as new. When nothing new is
  left, the commit answers `NOTHING_TO_IMPORT` and starts no run.
- A job still waiting in the queue (not yet processed) is refreshed by a re-import, keeping details fetched earlier
  (full description, hires, category, posting details, client link); a job is alerted at most once per recipient and
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
budget, currency, payment verification, client rating, client spend, client location, excluded keywords, and the
competition checks (already hired, proposal band, freelancers interviewing, invites sent: search results carry them, so
crowded or filled postings never cost a detail call). Unknown
values never reject at this point, and rules that need the full description or the client's hiring record (required
skills, include keywords, keyword coverage, required combinations, client hires, client hire rate, category) are left
to the run, after
the detail call. Every rule is applied in full during the run.

`detailsWanted` lists every new job (not already processed by the profile, inside the scan window) that passed
screening, up to `limits.maxDetailCalls` (40) per sync.
The agent stops early when Upwork's job-browse cooldown starts; jobs without details are still imported with search
data and get their details on a later sync.

## Request size

`scripts/leadpilot-import.mjs` sends only the fields LeadPilot reads (`scripts/lib/import-payload.mjs`, an allowlist):
descriptions are capped at 20,000 characters, review comments at 2,000 and each client list at 5 entries; requests are
split at 200 KB and 100 jobs, below the API's 256 KB body limit. The server applies the same caps again
(`src/modules/job-sources/upwork-import/normalize.ts`).

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
