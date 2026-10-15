# Deployment, Docker and backups

LeadPilot ships as a Docker Compose stack. One `docker-compose.yml` serves three uses:

| Use               | Command                                                                                         | What runs                               |
| ----------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------- |
| Local development | `docker compose up -d postgres`, then `npm run dev`                                             | Postgres only; the app runs on the host |
| Full stack, local | `docker compose --profile stack up -d --build`                                                  | Everything except Caddy                 |
| Production        | `docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile stack up -d --build` | Everything, behind Caddy (HTTPS)        |

Files: [`Dockerfile`](../Dockerfile), [`docker-compose.yml`](../docker-compose.yml),
[`docker-compose.prod.yml`](../docker-compose.prod.yml), [`deploy/Caddyfile`](../deploy/Caddyfile),
[`scripts/backup-db.sh`](../scripts/backup-db.sh), [`scripts/restore-db.sh`](../scripts/restore-db.sh).

## Architecture

```
                 Internet
                    │ 80 (redirects) / 443
                    ▼
              ┌──────────┐   Docker network "leadpilot_default" (nothing below is published in production)
              │  caddy   │──────────────────────────────────────────────────────────────┐
              └────┬─────┘                                                              │
                   │ reverse_proxy web:3000   (/api/internal/* answered 404 here)       │
                   ▼                                                                    │
              ┌──────────┐  POST /webhook/leadpilot-run  ┌──────────┐                   │
              │   web    │ ─────────────────────────────►│   n8n    │                   │
              │ Next.js  │ ◄──────────────────────────── │ (SQLite) │                   │
              └────┬─────┘  POST /api/internal/runs/...  └──────────┘                   │
                   │        (HMAC-signed)                                               │
                   ▼                                                                    │
              ┌──────────┐                                                              │
              │ postgres │  volume postgres-data                                        │
              └──────────┘ ─────────────────────────────────────────────────────────────┘
```

### Services

| Service      | Image                      | Kind     | Purpose                                                                                                                    |
| ------------ | -------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `postgres`   | `postgres:16.6-alpine`     | long-run | Application database. Volume `postgres-data`.                                                                              |
| `migrate`    | `leadpilot-migrator:local` | one-shot | Runs `npm run db:migrate` (idempotent). `web` starts only after it exits with 0.                                           |
| `web`        | `leadpilot-web:local`      | long-run | Next.js standalone server as the non-root `node` user. Health check: `GET /api/health`.                                    |
| `n8n-import` | `n8nio/n8n:2.42.7`         | one-shot | Creates the webhook credential from `N8N_WEBHOOK_SECRET`, imports and publishes the run workflow. `n8n` waits for it.      |
| `n8n`        | `n8nio/n8n:2.42.7`         | long-run | Orchestrates runs (`RUN_EXECUTOR=n8n`). Its own SQLite store in volume `n8n-data`; it never connects to Postgres.          |
| `caddy`      | `caddy:2.11.7-alpine`      | long-run | Production only. HTTPS with automatic Let's Encrypt certificates, HSTS, compression. Volumes `caddy-data`, `caddy-config`. |

The `Dockerfile` has two final targets built from shared stages: `runner` (Next's `output: "standalone"` bundle and
static assets only) and `migrator` (dependencies plus sources, for migrations and the seed).

### Ports

| Service  | Full stack (local)                     | Production             |
| -------- | -------------------------------------- | ---------------------- |
| postgres | `127.0.0.1:${POSTGRES_PORT:-55432}`    | not published          |
| web      | `127.0.0.1:${WEB_PORT:-3000}`          | not published          |
| n8n      | `127.0.0.1:${N8N_PORT:-5678}` (editor) | not published          |
| caddy    | —                                      | `80`, `443`, `443/udp` |

The production override removes the other ports with Compose's `!reset` tag, which needs Docker Compose v2.24 or
newer (verified with v5.4.0).

## Production setup

Requirements: a Linux server with Docker Engine and the Compose plugin, a DNS A/AAAA record for your hostname
pointing at it, and ports 80 and 443 open to the internet (Let's Encrypt validates over them).

1. Copy the repository to the server (for example `/opt/leadpilot`) and create `.env` from `.env.example`.
   Restrict it: `chmod 600 .env`.
2. Fill in at least: `POSTGRES_PASSWORD`, `AUTH_SECRET`, `RUN_EXECUTOR=n8n`, `N8N_WEBHOOK_SECRET`,
   `INTERNAL_API_SECRET`, `N8N_ENCRYPTION_KEY`, `APP_DOMAIN`, `ACME_EMAIL`, and for the first start
   `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`. Generate each secret separately (commands are in `.env.example`).
   `APP_BASE_URL` is set to `https://$APP_DOMAIN` by the override; the CSRF check accepts only that origin.
3. Start: `docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile stack up -d --build`
4. Create the first admin and the starter profile (once; re-running never resets the password):
   `docker compose --profile stack run --rm migrate npm run db:seed`
5. Open `https://$APP_DOMAIN` and sign in. Then remove `SEED_ADMIN_PASSWORD` from `.env`.

Tip: put `COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml` and `COMPOSE_PROFILES=stack` in the server's `.env`
so plain `docker compose up -d --build` uses the production setup.

### Updating

`git pull`, then the same `up -d --build` command. `migrate` applies new migrations before the new `web` starts, and
`n8n-import` re-imports the workflow from `n8n/workflows/leadpilot-run.json`. Take a backup first.

### The n8n editor

Not needed for normal operation: the workflow and its credential are imported automatically. Edits made in the
editor are overwritten on the next start, so change `n8n/workflows/leadpilot-run.json` instead. To look at
executions in production, tunnel to the container over SSH (Linux hosts route to container addresses):

```sh
# on the server
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' leadpilot-n8n-1
# on your machine
ssh -N -L 5678:<that address>:5678 user@server   # then open http://localhost:5678
```

## Backups

### What is backed up

| Data                 | Where                  | Backed up by                     | Notes                                                                                                                           |
| -------------------- | ---------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Application database | volume `postgres-data` | `scripts/backup-db.sh`           | Everything the app stores: users, profiles, runs, jobs, leads, notifications, audit log.                                        |
| `.env` (all secrets) | repository root        | **you**, separately and securely | Without `AUTH_SECRET` and `N8N_ENCRYPTION_KEY` a restored server cannot work as before. Never store it next to the dumps.       |
| n8n data             | volume `n8n-data`      | not backed up                    | Only execution history and the editor owner account. The workflow and credential are re-created from the repository and `.env`. |
| Certificates         | volume `caddy-data`    | not backed up                    | Caddy re-issues them. Avoid deleting the volume often: Let's Encrypt rate-limits re-issuance.                                   |

### Taking backups

```sh
scripts/backup-db.sh          # from the repository root; writes backups/leadpilot-YYYYMMDD-HHMMSS.dump
```

The script runs `pg_dump --format=custom` inside the `postgres` container (no password needed on the host), writes to a
`.partial` file, checks it is non-empty and readable with `pg_restore --list`, and only then renames it. Files are
created with mode 600. It then deletes dumps older than `BACKUP_KEEP_DAYS` days (default 14). `BACKUP_DIR` (default
`backups`) changes the folder. `backups/` is git-ignored and excluded from the Docker build context.

Daily at 03:00 with cron (as a user allowed to run `docker`):

```cron
0 3 * * * cd /opt/leadpilot && scripts/backup-db.sh >> backups/backup.log 2>&1
```

Not implemented: copying dumps off the server. A backup on the same disk does not survive losing the server, so copy
`backups/` elsewhere (another machine or object storage) on a schedule.

### Restoring

```sh
scripts/restore-db.sh backups/leadpilot-20261015-030000.dump --yes
```

1. Loads the dump into a scratch database `<db>_restore` in one transaction. A damaged file fails here and the live
   database is untouched.
2. Stops `web` (renaming needs a database without connections).
3. Renames the live database to `<db>_pre_restore_<timestamp>` and the scratch one to `<db>`, in one transaction.
4. Starts `web` again; Compose re-runs `migrate` first, so a dump from an older version is migrated forward.

Check the app, then drop the kept copy:
`docker compose exec postgres sh -c 'dropdb -U "$POSTGRES_USER" "${POSTGRES_DB}_pre_restore_<timestamp>"'`.
To roll back, run the same two renames the other way while `web` is stopped.

The restore also brings back the sessions table, so sessions that existed at backup time become valid again until they
expire. Restoring a dump made by a newer app version than the running one is not supported.

## Security notes

- Only Caddy is reachable from outside. Postgres, the web app and n8n are on the Docker network only.
- Caddy answers `/api/internal/*` with 404. Those routes are also HMAC-signed, so this is a second layer.
- Caddy has no `trusted_proxies`, so it discards any `X-Forwarded-For` a client sends and sets the real peer address.
  The app uses the first `X-Forwarded-For` entry for login rate limiting and session records
  (`clientIp` in `src/lib/http/api.ts`). Running `web` without Caddy in front would let clients choose that value; the
  local full stack is therefore bound to `127.0.0.1`.
- HSTS is `max-age=31536000` without `includeSubDomains`, because `APP_DOMAIN` may be an apex domain whose other
  subdomains are not served by LeadPilot.
- Session cookies are `Secure` and the app runs as a non-root user. Secrets come from `.env` only; none are baked into
  images (`.dockerignore` excludes `.env*`).
- n8n runs with `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` because the workflow reads `LEADPILOT_*` values with `$env`.
  Anyone who can edit workflows can therefore read n8n's environment, including `N8N_ENCRYPTION_KEY` and
  `LEADPILOT_INTERNAL_API_SECRET`. That is why the editor is never published in production; treat editor access as
  access to those secrets.
- On Docker Desktop (Windows/macOS) every request reaches Caddy from the Docker gateway address, so all clients share
  one rate-limit bucket there. On a Linux server, clients keep their real addresses.

## Verification (2026-10-15)

Run on Windows 11 with Docker Desktop (Engine 29.7.2, Compose v5.4.0), as an isolated Compose project with throwaway
secrets, mock providers and `RUN_EXECUTOR=n8n`. Caddy was published on `127.0.0.1:8080/8443` with
`APP_DOMAIN=localhost` (so Caddy used its local CA) because port 80 was taken on the test machine.

| Check                                                                             | Result                                                                                           |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Images build; `migrate` and `n8n-import` exit 0; `web`, `n8n`, `postgres` healthy | ✅                                                                                               |
| Seed via `docker compose --profile stack run --rm migrate npm run db:seed`        | ✅ admin and starter profile created                                                             |
| Run started over the API, executed by n8n                                         | ✅ `COMPLETED_WITH_ERRORS` in 2–3 s, all 7 stages completed (expected status with mock fixtures) |
| Production override: only Caddy publishes ports                                   | ✅ web and n8n host ports refuse connections                                                     |
| HTTP → HTTPS                                                                      | ✅ 308                                                                                           |
| HSTS header, `Server` header removed                                              | ✅                                                                                               |
| `POST /api/internal/...` through Caddy                                            | ✅ 404                                                                                           |
| Login + run through Caddy over HTTPS; session cookie `Secure`                     | ✅                                                                                               |
| Login with spoofed `X-Forwarded-For` / `X-Real-IP`                                | ✅ recorded the real peer address, not the spoofed ones                                          |
| Backup → change data → restore                                                    | ✅ data back to the backup state; app healthy and a run completed afterwards                     |
| Restore of a corrupt file                                                         | ✅ rejected by `pg_restore`; live data unchanged                                                 |
| Restore without `--yes`                                                           | ✅ refused                                                                                       |

Not verified: a real Let's Encrypt certificate on a public domain, a Linux host, behaviour after a host reboot, the
cron schedule, and n8n crashing in the middle of a run.

## Troubleshooting

- `migrate` exits non-zero: `docker compose logs migrate`. Usually a wrong `POSTGRES_PASSWORD` for an existing volume
  (the password is fixed when the volume is first created).
- `n8n-import` exits non-zero: `N8N_ENCRYPTION_KEY` or `N8N_WEBHOOK_SECRET` is missing, or the key was changed after
  n8n first started (n8n cannot decrypt its stored credential).
- 403 on every form: `APP_BASE_URL` does not match the address in the browser (CSRF origin check).
- Caddy cannot get a certificate: check DNS and that ports 80/443 reach the server; `docker compose logs caddy`.
- Docker Desktop on Windows: builds need several GB on drive C:. When C: filled up during development, Docker's data
  disk went read-only and the engine hung; freeing space, quitting Docker Desktop completely and running
  `wsl --shutdown` before starting it again recovered it with data intact.
