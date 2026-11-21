# Deployment

**Production: [Render + Neon](#render--neon-production)** at `https://leads.peepalx.com`, deployed from `main` once CI
passes. Docker is used twice: Render builds the production image from the [`Dockerfile`](../Dockerfile), and
[`docker-compose.yml`](../docker-compose.yml) runs the local development and test database.

Files: [`render.yaml`](../render.yaml), [`Dockerfile`](../Dockerfile), [`docker-compose.yml`](../docker-compose.yml),
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

(A self-hosted Docker Compose stack with Caddy, n8n, a Cloudflare Tunnel and an SSH deploy job existed until November 2026. It was never used in production and was removed; it remains in the git history.)

## Local database

```sh
docker compose up -d postgres   # Postgres 16 on 127.0.0.1:${POSTGRES_PORT:-55432}, volume postgres-data
```

On first start `database/docker/init` also creates the `leadpilot_test` database used by the integration and e2e tests.
The password comes from `POSTGRES_PASSWORD` in `.env` and is fixed when the volume is first created.

## The production image

The `Dockerfile` builds Next's `output: "standalone"` bundle and runs it as the non-root `node` user. Health check:
`GET /api/health`. Secrets come only from the environment; `.dockerignore` excludes `.env*`, so none are baked into
the image. Build it locally with `docker build --tag leadpilot-web:local .`.

## Render + Neon (production)

Chosen on 2026-11-16 because it costs nothing and needs no credit card (Oracle Cloud's free server needs one).
File: [`render.yaml`](../render.yaml) (Render Blueprint).

```
Browser ─HTTPS─► leads.peepalx.com (GoDaddy DNS, CNAME)    ─► Render free web service (Docker, runner image)
                                                                 ├─► Neon free Postgres (TLS)
                                                                 ├─► OpenAI API (scoring)
                                                                 └─► Brevo API (lead e-mails)
Upwork sync (Claude cloud routine) ─HTTPS─► https://leads.peepalx.com/api/import/*  (import token)
GitHub push to main ─► CI (.github/workflows/ci.yml) ─ all checks green ─► Render deploys that commit
```

Settings that matter on Render (all in `render.yaml`):

| Setting                    | Why                                                                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MIGRATE_ON_START=true`    | The free plan has no pre-deploy command: the server applies migrations at startup ([`src/instrumentation.ts`](../src/instrumentation.ts)); a failed migration exits the process, so Render keeps the previous version |
| `EMAIL_PROVIDER=brevo`     | Render's free plan blocks outbound SMTP ports 25, 465 and 587 ([`brevo-email.ts`](../src/modules/notifications/brevo-email.ts))                                                                                       |
| `DATABASE_URL` (Neon, TLS) | Render's free Postgres is deleted after 30 days; Neon's free plan does not expire                                                                                                                                     |

Render's own proxy terminates HTTPS. Runs execute inside the web service.

### Free-plan limits (checked 2026-11-16)

- **Sleep:** the service stops after 15 minutes without requests; the next visit waits about a minute while it starts
  (and applies migrations). A run in progress when it falls asleep stops; open it and click **Resume**. Keep the run
  page open while a run is working: its progress polling counts as traffic.
- **750 free hours a month per workspace**: enough for this one service; do not add a second free service.
- **512 MB memory, shared CPU.** Enough for 3–4 users.
- **Neon free:** 0.5 GB storage per project and 100 compute-hours a month; the database sleeps after 5 minutes idle
  and wakes in about a second (the health check waits up to 5 s). Delete old runs/jobs if storage gets close.
- **No shell on Render free:** one-off commands (the seed) run from your PC against `DATABASE_URL` (below).
- **No backups on Neon free beyond its short history window.** Export now and then (`pg_dump` with the Neon URL).

### One-time setup

1. **Neon:** create project `leadpilot` in **AWS Europe Central (Frankfurt)** (same region as the Render service).
   Copy the **direct** connection string (not the `-pooler` host) ending in `?sslmode=require` (the app upgrades this to `sslmode=verify-full`, so Neon's certificate is checked;
   `src/lib/database/url.ts`).
2. **Brevo:** create a free account, verify the sender address under **Senders**, create an API key under
   **SMTP & API → API keys**.
3. **Render:** sign in with GitHub → **New → Blueprint** → pick this repository → Render reads `render.yaml` and asks
   for the `sync: false` values: `DATABASE_URL`, `OPENAI_API_KEY`, `BREVO_API_KEY`, `EMAIL_FROM`. `AUTH_SECRET`
   is generated by Render; never change it later (it would sign everyone out and invalidate import tokens).
4. **Domain:** Render → service → **Settings → Custom Domains** shows the target for `leads.peepalx.com`. In
   the DNS of `peepalx.com` add `CNAME leads → <service>.onrender.com`. The domain uses **GoDaddy** nameservers
   (`ns27`/`ns28.domaincontrol.com`), so add it in GoDaddy → DNS; a record in Cloudflare has no effect unless the
   nameservers are moved there (then use **Proxy status: DNS only** so Render can issue the certificate). Wait until Render shows the domain as verified.
5. **First admin** (once, from the repository on your PC; the password never leaves your machine):

   ```sh
   DATABASE_URL='<Neon direct URL>' SEED_ADMIN_EMAIL='you@example.com' SEED_ADMIN_PASSWORD='<12+ characters>' npm run db:seed
   ```

   On Windows PowerShell set the three values with `$env:NAME='...'` first. The service must have started once
   (so the tables exist).

6. Open `https://leads.peepalx.com`, sign in, create an import token (Settings), and give it to the Upwork sync's
   cloud routine ([upwork-sync.md](upwork-sync.md#running-the-sync-in-the-cloud-production-setup)).

Use `https://leads.peepalx.com` only: the `*.onrender.com` address also answers, but forms there fail the CSRF origin
check because `APP_BASE_URL` is the custom domain.

### Deploys

Push to `main` → GitHub Actions runs every check → when they all pass, Render builds the Docker image and deploys it
(`autoDeployTrigger: checksPass`). Render keeps the previous version running until the new one answers its health
check (`/api/health`); a failed migration or a missing setting therefore leaves the old version live. Roll back with
**Render → service → Events → Rollback**.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) (GitHub Actions) tests every pull request and every push to
`main`:

```
git push ──► GitHub Actions
              ├─ quality       format:check, lint, typecheck, test:unit
              ├─ integration   test:integration against a Postgres service container
              ├─ e2e           test:e2e (Playwright, Chromium) against a Postgres service container
              └─ build         next build; the production Docker image (not pushed); docker compose config
                    │ all green on main
                    ▼
              Render deploys that commit (autoDeployTrigger: checksPass)
```

- The test jobs use throwaway values and the test fakes only. **No application secret is stored in GitHub**; they live
  in Render's environment settings.
- Pull requests run the checks but never deploy. A newer push to the same pull request cancels the older run.
- Workflow actions are pinned to commit SHAs.

## Backups

Everything the app stores (users, profiles, runs, jobs, clients, leads, notifications, audit log) is in the Neon
database. Neon's free plan keeps only a short history window, so export now and then from your PC:

```sh
pg_dump --format=custom --file leadpilot-$(date +%Y%m%d).dump '<Neon direct URL>'
```

Restore into an empty database with `pg_restore --no-owner --dbname '<URL>' <file>`. Keep dumps and the Render
environment values (above all `AUTH_SECRET`) somewhere safe and separate: without `AUTH_SECRET` a restored database
signs everyone out and invalidates import tokens.

## Security notes

- Session cookies are `Secure`; the app runs as a non-root user; no secret is in the image or in GitHub.
- The client address for login rate limits and session records is the **last** `X-Forwarded-For` entry, the one
  Render's proxy appends (`clientIp` in `src/lib/http/api.ts`; `TRUSTED_PROXY_HOPS`, default 1). Tested on
  2026-11-21: Render passes a client-supplied first entry through unchanged, so the earlier code (first entry) let a
  client pick its own rate-limit bucket.
- No HSTS header yet: Render does not add one ([PENDING.md](PENDING.md)).
- Anyone who can push to `main` deploys to production once the checks pass. Keep GitHub access small and use 2FA on
  GitHub, Render, Neon and Brevo.

## Troubleshooting

- The deploy stays on the old version: Render keeps it until the new one passes `/api/health`. Read the deploy log for
  a failed migration or an invalid setting (the log names the variable, never its value).
- 403 on every form: the browser address is not `APP_BASE_URL` (for example the `*.onrender.com` address); use
  `https://leads.peepalx.com`.
- First request after a quiet period takes about a minute: the free service was asleep (see the free-plan limits).
- Docker Desktop on Windows: builds need several GB on drive C:. When C: filled up during development, Docker's data
  disk went read-only and the engine hung; freeing space, quitting Docker Desktop completely and running
  `wsl --shutdown` before starting it again recovered it with data intact.
