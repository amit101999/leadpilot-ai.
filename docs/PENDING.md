# LeadPilot: pending work (as of 2026-11-17)

Everything still needed to make LeadPilot fully work in production, grouped by area. Each item says **what**,
**why**, **who** does it (**You** = needs your accounts, clicks or secrets; **Claude** = code/config I can do) and
roughly how long it takes.

Priority: **P0** = the system does not work without it · **P1** = needed soon for safe daily use · **P2** = later /
nice to have.

---

## Where things stand today

| Area                                            | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Code (app, pipeline, import API, e-mail alerts) | ✅ Built, tested (163 unit, 74 integration, 19 browser tests), on GitHub `main`                                                                                                                                                                                                                                                                                                                                                                              |
| GitHub CI                                       | ✅ Runs on every push; all checks green on the last verified run                                                                                                                                                                                                                                                                                                                                                                                             |
| Render (hosting)                                | ✅ Service `leadpilot` live at `https://leadpilot-hcrz.onrender.com`, health OK (re-checked 2026-11-17: HTTP 200 after a ~16 s wake-up), migrations applied                                                                                                                                                                                                                                                                                                  |
| Neon (database)                                 | ✅ Project `leadpilot` (Frankfurt) connected; 19 tables created                                                                                                                                                                                                                                                                                                                                                                                              |
| Domain `leads.peepalx.com`                      | ✅ CNAME `leads` → `leadpilot-hcrz.onrender.com` added in **GoDaddy** (the domain uses GoDaddy nameservers, not Cloudflare); Render shows it **Verified**; `https://leads.peepalx.com` answers 200 with a valid certificate (2026-11-17). Render still reports **Certificate Error**: the certificate served is `peepalx.com`/`*.peepalx.com` from Google Trust Services (issued 2026-11-02), not one Render issued, see [Domain DNS 3](#domain-dns-godaddy) |
| First login                                     | ✅ Working 2026-11-17: sign-in with username `amit101999` (Render settings `ADMIN_USERNAME` / `ADMIN_PASSWORD`, deployed `0e18ac8`)                                                                                                                                                                                                                                                                                                                          |
| Brevo (e-mail)                                  | ⚠️ Key and sender set in Render, but no e-mail sent yet; domain authentication missing                                                                                                                                                                                                                                                                                                                                                                       |
| OpenAI (AI scoring)                             | ⚠️ Key set in Render, never tested live                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Upwork jobs → LeadPilot                         | ⚠️ Works only from your PC through Claude Code; not yet pointed at the live site                                                                                                                                                                                                                                                                                                                                                                             |
| Job source setting                              | ⏳ Was `mock` in production (manual **Run now** used demo jobs, scored by real OpenAI, could e-mail fake leads). Code for `JOB_SOURCE_PROVIDER=import` ready (2026-11-17); after it deploys, set `JOB_SOURCE_PROVIDER=import` in Render → Environment                                                                                                                                                                                                        |

---

## Minimum path to a working system (do these in order)

1. ~~**Add the DNS record in GoDaddy**~~ Done 2026-11-17.
2. ~~**Wait for Render to verify `leads.peepalx.com`**~~ Verified 2026-11-17; HTTPS works (Render certificate status still red, see [Domain DNS 3](#domain-dns-godaddy)).
3. ~~**Set up the login**~~ Done 2026-11-17 (username login from the Render settings).
4. **Sign in at `https://leads.peepalx.com`** and click **Test connection** on **Integrations** for AI scoring and e-mail
   (P0, You, 2 min).
5. **Add yourself as an e-mail recipient** and run a test (P0, You, 5 min): see [E-mail 3](#e-mail-and-notifications-brevo).
6. **Create an import token on the live site and point the Upwork sync at it** (P0, You, 5 min): see
   [Upwork 1](#upwork-connection-claude--upwork-mcp).
7. **Run one sync by hand** and confirm a lead e-mail arrives (P0, You + Claude, 10 min).

After step 7 the system works end to end. Everything below that is not P0 makes it safer, more reliable or more
automatic.

---

## Login and users

1. **P0 · You · 3 min: admin login from the Render settings (chosen 2026-11-17).** No seed needed: in Render →
   `leadpilot` → **Environment**, add `ADMIN_USERNAME` (your username) and `ADMIN_PASSWORD` (8+ characters), save
   (Render redeploys), then sign in at `https://leads.peepalx.com/login` with that username. The app creates one
   ADMIN user record for it on first login. Change the password in Render, not in the app. Needs the login change on
   `main` first (branch `worktree-pending-fixes`).

   _Alternative (a real e-mail account, e.g. for more users later):_ the app has **no sign-up page**, so even a "simple login" needs one
   user in the database. The seed command creates it (role ADMIN, which is just the account that can do everything)
   plus a starter search profile. Run it in **your own PowerShell** from the project folder, so the password never
   passes through chat:

   ```powershell
   $env:DATABASE_URL='<Frankfurt Neon connection string>'
   $env:SEED_ADMIN_EMAIL='you@example.com'
   $env:SEED_ADMIN_PASSWORD='<at least 12 characters>'
   npm run db:seed
   Remove-Item Env:DATABASE_URL, Env:SEED_ADMIN_EMAIL, Env:SEED_ADMIN_PASSWORD
   ```

2. **P1 · Claude · ~½ day: a way to add the other 2–3 users.** There is no user-management page or API
   (`docs/api.md`, "Not implemented"); users can only come from the seed or SQL. Options:
   - a small script `npm run user:create` (email, name, role, password prompt), run like the seed; or
   - an admin page **Settings → Users** (create, disable, reset password). Better for daily use; more work.
3. **P2 · Claude: account lockout / two-factor login.** Today only rate limits slow down password guessing
   (`docs/security.md`).

## Domain DNS (GoDaddy)

`peepalx.com` is served by GoDaddy's nameservers (checked 2026-11-17 with public DNS: `ns27.domaincontrol.com`,
`ns28.domaincontrol.com`). The domain was added to Cloudflare, but its nameservers were never switched there, so
**every DNS record must be added in GoDaddy**. Keep it that way: switching nameservers to Cloudflare would replace
all existing records (Zoho mail, website) and could break your e-mail unless every record is copied first.

1. ~~**P0 · You · 2 min: add the CNAME in GoDaddy.**~~ **Done 2026-11-17.** GoDaddy → **My Products → `peepalx.com` → DNS → Add New Record**:
   Type **CNAME**, Name **`leads`**, Value **`leadpilot-hcrz.onrender.com`**, TTL default (1 hour) → **Save**. Do not
   change any other record. Check: `nslookup leads.peepalx.com` shows `leadpilot-hcrz.onrender.com` (usually within
   minutes, at most the TTL).
2. **P1 · You (I can guide) · 10 min: e-mail authentication records for Brevo**, also in GoDaddy. See
   [E-mail 2](#e-mail-and-notifications-brevo).
3. **P1 · You · 5 min: Render certificate.** Render shows _Certificate Error_ although the site serves a valid
   certificate for `peepalx.com` and `*.peepalx.com` (Google Trust Services, issued 2026-11-02, before the Render
   service existed). It most likely comes from the unused Cloudflare zone for `peepalx.com` (Render routes traffic
   through Cloudflare). If Render still shows the error after an hour: delete the `peepalx.com` site in Cloudflare
   (DNS is at GoDaddy, so nothing uses it), then click **Verify** again in Render → `leadpilot` → Settings → Custom
   Domains, so Render issues and renews its own certificate.
4. **P2 · You decide: delete the unused tunnel `leadpilot`** (Zero Trust → Networks → Tunnels). Costs nothing to keep.

## Render

1. ~~**P0 · automatic: custom domain and HTTPS.**~~ Verified 2026-11-17 (certificate status: see [Domain DNS 3](#domain-dns-godaddy)). After the GoDaddy CNAME is saved, Render verifies
   `leads.peepalx.com` and issues the certificate (Render → `leadpilot` → Settings → Custom Domains). If it stays
   "unverified" for more than an hour, tell me.
2. **P1 · You · 2 min: replace `BREVO_API_KEY`.** The key you pasted in chat is exposed: delete it in Brevo, create a
   new one, paste it in Render → `leadpilot` → Environment, then save (Render redeploys).
3. **P1 · Claude · 30 min: add the HSTS header.** Render does not send `Strict-Transport-Security` (the old Caddy setup
   did). I'll add it in `next.config.ts` for production.
4. **P1 · Claude · 15 min: verify real visitor IPs.** Login rate limiting reads the first `X-Forwarded-For` entry.
   Whether Render replaces a fake value sent by a visitor is not yet verified (`docs/security.md`). Test after first
   login, then fix `clientIp` if needed.
5. **Know the free-plan limits** (no action, but plan around them):
   - The app **sleeps after 15 minutes** without visitors; the next visit waits about a minute.
   - A run that is working when the app falls asleep stops; open it and click **Resume**. Keep the run page open
     while a run works.
   - **750 free hours a month** for the whole workspace (your other free apps share them only while awake).
   - **500 build minutes a month**; each deploy uses a few. Avoid dozens of tiny pushes a day.
   - Logs are kept 7 days.
6. **P2 · You decide: your other Render services** (`job-portal-backend`, `job-portal-backend-`,
   `task-management-application-backend`). They share the free hours if anyone visits them. Suspend them if unused.

## Neon (database)

1. **P1 · You · 2 min: delete the Ohio project `upwork agent`.** It is unused and its password was pasted in chat.
   (Neon → project → Settings → Delete project.) Do **not** touch `leadpilot` (Frankfurt) or `cab-booking-app`.
2. **P1 · Claude · ~1 h: automatic backups.** Neon's free plan only keeps a short history. Proposal: a weekly GitHub
   Actions job that runs `pg_dump` against Neon and stores the file as a private build artifact (free; you add the
   database URL as a GitHub secret yourself).
3. **P2 · Plan: storage limit.** The free plan holds 0.5 GB per project. That is plenty for months, but job text and
   logs only grow. Decide a retention rule (e.g. delete jobs and runs older than 6 months) and I'll build a cleanup
   job.
4. **Know the limit:** 100 compute-hours a month. The database sleeps after 5 minutes idle, so normal use by 3–4 people
   fits comfortably.

## E-mail and notifications (Brevo)

1. **P0 · You · done?: sender verified in Brevo.** You said it is verified. `EMAIL_FROM` in Render must be exactly that
   address (e.g. `LeadPilot <alerts@peepalx.com>`).
2. **P1 · You + Claude · 10 min: authenticate your domain in Brevo.** `peepalx.com` has a strict DMARC policy
   (`p=quarantine`) and its SPF record only allows Zoho. E-mails from `@peepalx.com` sent through Brevo without
   Brevo's DKIM and SPF records may land in **spam or be dropped**. In Brevo → **Senders, Domains & IPs → Domains →
   Authenticate**, Brevo shows 2–3 DNS records. Add them in **GoDaddy** DNS (see [Domain DNS](#domain-dns-godaddy));
   the existing Zoho records stay. SPF must stay **one** TXT record: add Brevo's `include:` to the existing Zoho SPF
   record instead of creating a second one.
   If you send from a Gmail address instead, delivery is less reliable (Gmail's own DMARC).
3. **P0 · You · 5 min: set recipients and test.** In LeadPilot **Settings → Recipients**, add the people who should
   get lead alerts and enable them. Then **Integrations → E-mail → Send test message**. Without an enabled recipient no alert
   is ever sent.
4. **Know the limit:** Brevo free sends **300 e-mails a day**. Fine for 3–4 users.
5. **P2 · Plan: other channels.** WhatsApp was removed on 2026-11-14; e-mail is the only alert channel. Telegram or
   Slack alerts would be new features.

## AI scoring (OpenAI)

1. **P0 · You · 1 min: test the key.** **Integrations → AI scoring → Test connection** on the live site. The key in Render has never been
   used live.
2. **P1 · You · 5 min: set a spending limit** in OpenAI → Billing → Limits. `gpt-4o-mini` is cheap, but OpenAI is the
   one service here that costs money per use.

## Upwork connection (Claude + Upwork MCP)

How it works today: LeadPilot **cannot** read Upwork by itself. **Claude Code on your PC**, with Upwork's official
connector, searches Upwork and sends the jobs to LeadPilot's import API (`docs/upwork-sync.md`).

1. **P0 · You · 5 min: point the sync at the live site.**
   1. Sign in at `https://leads.peepalx.com` → **Settings → Import tokens** → create a token (shown once).
   2. In your PC's `.env`: `LEADPILOT_URL=https://leads.peepalx.com` and `LEADPILOT_IMPORT_TOKEN=<token>`. Tokens from
      your local database do not work on the live site.
2. **P0 · You · 2 min: confirm the Upwork connector works in Claude Code.** In this terminal:
   `claude -p "Call the Upwork tool list_accounts and reply with the account type only"`. If it fails, reconnect the
   Upwork connector in claude.ai → Settings → Connectors.
3. **P0 · You · 2 min: set up a search profile for syncing.** On a profile → **Search & sync**: keywords, interval,
   active hours, time zone, sync on.
4. **P0 · You + Claude · 10 min: first live sync.** Run `powershell -File scripts\upwork-sync.ps1` (or `/upwork-sync`
   here). The first request may take about a minute while Render wakes up. Check **Search History** for the run and
   your inbox for an alert. Not yet verified: one uninterrupted run from search to e-mail (the November test was
   interrupted by low memory on the PC).
5. **P1 · Plan + You decide: automatic (scheduled) syncing.** Upwork's API & MCP terms reportedly limit automated,
   continuous monitoring of job posts. LeadPilot therefore ignores scheduled syncs until
   `UPWORK_SYNC_SCHEDULED_ALLOWED=true` (currently `false` in `render.yaml`). Read the terms, then decide. If yes:
   change that setting and create the hourly Windows task (`docs/upwork-sync.md`, "Scheduling").
6. **P1 · Plan: where the sync agent runs.** Today it needs **your PC on and signed in**. Options:
   - **Keep the PC** (works now; syncs only while the PC is on).
   - **Claude Code cloud routine** (Claude's scheduled agents run in the cloud, no PC needed). Not yet tested: whether
     the Upwork connector and the import token work there. Worth a trial.
   - **Claude on the web (claude.ai)** can use the Upwork connector in chat, but it cannot run the repository's sync
     scripts, so it is not a replacement for the automated sync.
7. **P2 · Blocked: direct Upwork API.** LeadPilot calling Upwork itself needs an **approved Upwork API key** with
   job-search access. Upwork's own documentation says the API is not for commercial use. Blocked until Upwork approves
   (`docs/upwork-access.md`).

## Claude Code / MCP connections

| Connection                   | Status                                      | Needed for                                   |
| ---------------------------- | ------------------------------------------- | -------------------------------------------- |
| Upwork (claude.ai connector) | ✅ connected                                | Upwork sync (essential)                      |
| Render (plugin)              | ✅ connected                                | I can check deploys, logs and health         |
| Claude in Chrome             | ✅ connected                                | dashboard clicks in Cloudflare, Neon, Render |
| n8n-mcp                      | ❌ fails (points at local n8n, not running) | Not needed on Render. Remove it or leave it  |
| Zoho Catalyst plugin         | ❌ invalid URL                              | Not related to LeadPilot. Remove or fix      |
| Cloudflare, Neon, Brevo      | no connector                                | Not needed; the browser works                |

## Coding

| #   | Priority | Item                                                                                                                                                                              | Effort            |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 1   | P1       | User management (script or Settings → Users page), see [Login and users 2](#login-and-users)                                                                                      | ½–1 day           |
| 2   | P1       | HSTS header for production                                                                                                                                                        | 30 min            |
| 3   | P1       | Check and, if needed, fix `clientIp` behind Render                                                                                                                                | 15–60 min         |
| 4   | P1       | Weekly database backup job (GitHub Actions + `pg_dump`)                                                                                                                           | 1 h               |
| 5   | P2       | Content-Security-Policy header (defence against script injection)                                                                                                                 | ½ day             |
| 6   | P2       | Data-retention cleanup job                                                                                                                                                        | ½ day             |
| 7   | P2       | Clean up the unused server deployment path: the CI `deploy` job (SSH), `scripts/deploy.sh`, Cloudflare Tunnel compose files. Keep them as a documented alternative or remove them | 1 h               |
| 8   | P2       | Automatic resume of runs stopped by Render's sleep (today: manual **Resume**)                                                                                                     | ½ day             |
| 9   | Blocked  | Live Upwork API adapter (needs an approved key)                                                                                                                                   | days              |
| 10  | P2       | Dev-only `npm audit` advisories (`eslint-config-next`, `drizzle-kit`); 0 in production dependencies                                                                               | wait for upstream |

## Planning and system-design decisions (yours)

1. **Scheduled Upwork syncing: allowed or not?** Depends on Upwork's terms ([Upwork 5](#upwork-connection-claude--upwork-mcp)).
2. **Where the sync runs:** your PC, or a trial of a Claude cloud routine ([Upwork 6](#upwork-connection-claude--upwork-mcp)).
3. **Users:** who gets accounts, and which role (ADMIN / OPERATOR / VIEWER).
4. **E-mail sender:** an address on `peepalx.com` (needs [E-mail 2](#e-mail-and-notifications-brevo)) or a Gmail address.
5. **Data retention:** how long to keep jobs, runs and audit logs.
6. **Free-plan trade-offs accepted?** Sleep/wake delay and manual Resume. The only free way to avoid them is a server
   of your own.

## Testing and verification still to do (live)

- Login on `https://leads.peepalx.com`; a session cookie over HTTPS.
- OpenAI scoring inside a real run.
- A real Brevo lead e-mail reaching the inbox (not spam).
- One uninterrupted Upwork sync from search → import → run → e-mail.
- Behaviour when Render wakes from sleep during a sync, and **Resume** after a run stopped by sleep.
- Real visitor IP in the session list (rate limiting).
- A first deploy through CI → Render after a code change (the `checksPass` trigger), and a rollback in Render.

## Security clean-up (do soon)

| Item                                                                                | Why                                                                            | Who |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --- |
| Delete the Brevo API key pasted in chat; create a new one; update Render            | It is exposed in the chat history                                              | You |
| Delete the Neon project `upwork agent` (Ohio)                                       | Its database password was pasted in chat                                       | You |
| Never paste keys or passwords in chat again; enter them straight into Render/GitHub | Chat history is not a secret store                                             | You |
| Turn on two-factor login for GitHub, Render, Neon, Cloudflare, Brevo                | Anyone with GitHub access can push to `main`, and `main` deploys to production | You |
| Set an OpenAI spending limit                                                        | The only pay-per-use service                                                   | You |

## Documentation

- **P1 · Claude:** update `docs/progress/PROGRESS.md` with the Render + Neon + Brevo work (2026-11-16/17) through the
  project tracker.
- **P1 · Claude:** in `docs/deployment.md`, mark the server/Cloudflare-Tunnel CI deploy as an alternative and describe
  the live Render deploy flow first (partly done).
- **P2 · Claude:** `docs/upwork-sync.md` still shows `http://localhost` examples; add the live URL.

---

## Costs (all free today)

| Service              | Plan                                       | Cost                   |
| -------------------- | ------------------------------------------ | ---------------------- |
| GitHub (repo + CI)   | Free, private repo, 2,000 CI minutes/month | $0                     |
| Render               | Hobby, free web service                    | $0                     |
| Neon                 | Free                                       | $0                     |
| Cloudflare           | Free (DNS)                                 | $0                     |
| Brevo                | Free, 300 e-mails/day                      | $0                     |
| Domain `peepalx.com` | already owned                              | renewal yearly         |
| OpenAI               | pay per use (`gpt-4o-mini`)                | small; set a limit     |
| Claude (Upwork sync) | your Claude plan                           | uses your Claude usage |
