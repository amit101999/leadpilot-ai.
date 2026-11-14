# Deployment, Docker and backups

LeadPilot ships as a Docker Compose stack. One `docker-compose.yml` serves four uses:

| Use               | Command                                                                                               | What runs                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Local development | `docker compose up -d postgres`, then `npm run dev`                                                   | Postgres only; the app runs on the host                                              |
| Full stack, local | `docker compose --profile stack up -d --build`                                                        | Everything except Caddy                                                              |
| Production        | `docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile stack up -d --build`       | Everything, behind Caddy (HTTPS)                                                     |
| Cloudflare Tunnel | `docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml --profile stack up -d --build` | Everything, through a Cloudflare Tunnel; no open ports ([below](#cloudflare-tunnel)) |

Files: [`Dockerfile`](../Dockerfile), [`docker-compose.yml`](../docker-compose.yml),
[`docker-compose.prod.yml`](../docker-compose.prod.yml), [`deploy/Caddyfile`](../deploy/Caddyfile),
[`docker-compose.cloudflare.yml`](../docker-compose.cloudflare.yml), [`deploy/Caddyfile.cloudflare`](../deploy/Caddyfile.cloudflare),
[`scripts/backup-db.sh`](../scripts/backup-db.sh), [`scripts/restore-db.sh`](../scripts/restore-db.sh),
[`scripts/deploy.sh`](../scripts/deploy.sh), [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) ([CI/CD](#cicd)).

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
`n8n-import` re-imports the workflow from `n8n/workflows/leadpilot-run.json`. Take a backup first. With
[CI/CD](#cicd) this happens automatically: `scripts/deploy.sh` backs up, checks out the commit and restarts the stack
(the checkout is then a detached commit, so use `scripts/deploy.sh <sha>` rather than `git pull` by hand).

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

## Cloudflare Tunnel

Publishes LeadPilot at `https://<subdomain>.<your domain>` through Cloudflare, with no open ports and no public IP
address needed. Use it when the domain's DNS is on Cloudflare (a domain bought at GoDaddy or elsewhere works once its
nameservers point to Cloudflare). The Cloudflare features used here (DNS, Tunnel, Access) are on the free plan.

```
Browser ─HTTPS─► Cloudflare ─(outbound tunnel)─► cloudflared ─HTTP─► caddy:80 ─► web:3000 ─► postgres
                                                  └──────────── Docker network, nothing published ────────────┘
Upwork sync agent (your PC, Claude Code) ─HTTPS─► https://APP_DOMAIN/api/import/*  (import token)
```

`cloudflared` connects out to Cloudflare; Cloudflare sends visitors for `APP_DOMAIN` down that connection. Caddy stays
in the stack (plain HTTP, internal only) to block `/api/internal/*`, set headers and pass the visitor's real address to
the app ([`deploy/Caddyfile.cloudflare`](../deploy/Caddyfile.cloudflare)). Use `docker-compose.cloudflare.yml`
_instead of_ `docker-compose.prod.yml`.

### Where it runs

| Machine                          | Cost              | Notes                                                                                                                                                                                                                                                                     |
| -------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VPS (Linux, ≥ 2 GB RAM)          | about $5–12/month | Always on. Install Docker Engine with the Compose plugin.                                                                                                                                                                                                                 |
| Your Windows PC (Docker Desktop) | free              | Online only while the PC is on and awake: set Docker Desktop to start at sign-in and turn off sleep. The stack needs about 1.5–2 GB RAM, and building the images several GB more. It shares the `leadpilot` Compose project (and data) with local development; see below. |

### 1. Create the tunnel (Cloudflare dashboard)

1. **Zero Trust** (left menu of dash.cloudflare.com) → **Networks → Tunnels → Create a tunnel** → **Cloudflared** → name
   it, e.g. `leadpilot`.
2. On the install page, copy the **token**: the long value after `--token` in any of the install commands. Do not run
   the install command; the stack runs `cloudflared` itself.
3. **Public hostname** (next step of the wizard, or the tunnel's _Public Hostnames_ tab → _Add_):
   - Subdomain: e.g. `leads`; Domain: your domain. Pick a name that is not already in the domain's DNS records.
   - Service: Type **HTTP**, URL **`caddy:80`**.
4. Save. Cloudflare creates the DNS record for the subdomain itself; existing records (e.g. your other website) are
   untouched. Nothing changes at the registrar (GoDaddy).

### 2. Configure and start

In `.env` next to `docker-compose.yml` (`chmod 600 .env` on Linux):

- `APP_DOMAIN` = the full hostname, e.g. `leads.example.com`; `CLOUDFLARE_TUNNEL_TOKEN` = the token from step 1.
- The same required values as [Production setup](#production-setup) step 2, except `ACME_EMAIL` (not used).
- For alerts and scoring: `EMAIL_PROVIDER`, `SMTP_*`, `EMAIL_FROM`, `AI_PROVIDER`, `OPENAI_API_KEY`.

```sh
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml --profile stack up -d --build
docker compose --profile stack run --rm migrate npm run db:seed   # first time only, on an empty database
```

Within a minute the tunnel shows **Healthy** in the dashboard and `https://APP_DOMAIN` serves the login page. To make
plain `docker compose up -d --build` use this setup, add to `.env`: `COMPOSE_PROFILES=stack` and
`COMPOSE_FILE=docker-compose.yml:docker-compose.cloudflare.yml` (on Windows separate the files with `;` instead of `:`).
Updating and backups work as in [Updating](#updating) and [Backups](#backups).

**On the development PC**: the stack uses the same Compose project name (`leadpilot`), so it reuses the development
database volume and its data, and `POSTGRES_PASSWORD` must be the one that volume was created with. While the stack runs,
Postgres is no longer published on `127.0.0.1:55432`, so `npm run dev` cannot reach it; stop the stack (`docker compose
-f docker-compose.yml -f docker-compose.cloudflare.yml --profile stack down`, data is kept) and start Postgres alone
(`docker compose up -d postgres`) to develop again.

### 3. Point the Upwork sync at it

On the computer that runs the agent (Claude Code with the Upwork connector), create an import token on the **live**
site (Settings → Import tokens) and set in that computer's `.env`: `LEADPILOT_URL=https://APP_DOMAIN` and
`LEADPILOT_IMPORT_TOKEN`. Tokens from a local development database do not exist on the live site.

### Optional: Cloudflare Access

Adds Cloudflare's login (e.g. a one-time code sent to your e-mail) in front of the whole site, before LeadPilot's own
login. Free for up to 50 users.

1. **Zero Trust → Access → Applications → Add an application → Self-hosted**: application domain `APP_DOMAIN`, policy
   _Allow_ with _Include → Emails_ = your address(es).
2. The Upwork sync script cannot answer that login. Add a second self-hosted application for the same domain with path
   `api/import`, policy action **Bypass**, _Include → Everyone_. The more specific path wins, so only the import API skips
   Access; it is protected by the import token and its rate limit.
3. If **Bot Fight Mode** (Security → Bots) is on, Cloudflare may challenge the script's requests; turn it off for this
   domain if the sync reports HTML or 403 responses.

## CI/CD

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) (GitHub Actions) tests every pull request and every push to
`main`; when everything passes on `main`, it deploys that commit to the server with
[`scripts/deploy.sh`](../scripts/deploy.sh). It assumes the [Cloudflare Tunnel](#cloudflare-tunnel) setup on a Linux
server.

```
git push ──► GitHub Actions
              ├─ quality       format:check, lint, typecheck, test:unit
              ├─ integration   test:integration against a Postgres service container
              ├─ e2e           test:e2e (Playwright, Chromium) against a Postgres service container
              └─ build         next build; `docker compose config` for the base, prod and cloudflare files
                    │ all green, push to main, DEPLOY_ENABLED=true
                    ▼
              deploy ──ssh via cloudflared──► Cloudflare Access (service token) ──► SSH tunnel ──► server :22
                                                                                         │
                                         scripts/deploy.sh <sha> ◄── forced command ─────┘
                                           backup DB → git checkout <sha> → docker compose up -d --build
                                           (migrate runs first) → wait until every service is healthy
```

- The test jobs use throwaway values and mock providers only. **No application secret is stored in GitHub**; they stay
  in the server's `.env`.
- Pull requests run the checks but never deploy. A newer push to the same pull request cancels the older run; runs on
  `main` are never cancelled, and deploys run one at a time.
- Until the server is ready, leave the repository variable `DEPLOY_ENABLED` unset: the checks still run and the
  `deploy` job is skipped.
- The server builds the images itself (as in [Updating](#updating)), so nothing is pushed to a container registry.

### What `scripts/deploy.sh` does

1. Accepts only a full 40-character commit SHA (from `SSH_ORIGINAL_COMMAND`, or as the first argument when run by
   hand) and refuses commits that are not on `origin/main`.
2. Takes a lock (`.deploy.lock`), so two deploys never overlap.
3. Refuses to run if tracked files were edited on the server.
4. Backs up the database with `scripts/backup-db.sh` (skipped only when Postgres is not running, i.e. the first
   deploy). A failed backup stops the deploy before anything changes.
5. Checks out the commit and runs `docker compose up -d --build --remove-orphans`. The `migrate` service applies new
   migrations before `web` starts.
6. Waits up to 300 s (`DEPLOY_HEALTH_TIMEOUT`) until every container is healthy, running, or (one-shots) exited with 0.
   Otherwise it prints `docker compose ps` and the last 100 log lines of `migrate` and `web`, and the GitHub run fails.
7. Writes the commit to `.deployed-sha` and removes dangling images.

There is **no automatic rollback**, because migrations only go forward. To go back, open the GitHub run of the previous
good commit and choose **Re-run all jobs**, or on the server run `scripts/deploy.sh <previous sha>`. This is safe when
the newer commit's migrations only added things; a migration that renamed or dropped something needs a database restore
([Restoring](#restoring)) from the backup the deploy just took.

### One-time setup

Order: server → domain on Cloudflare → app tunnel → SSH tunnel → GitHub settings.

**1. Server.** Ubuntu 24.04 LTS with at least 2 GB RAM (4 GB, or 2 GB plus swap, for the image build) and Docker Engine
with the Compose plugin. Firewall: allow no inbound ports at all (both tunnels connect outwards); keep the provider's
web console for emergencies.

**2. Deploy user and checkout.**

```sh
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy           # docker access is root-equivalent; this user exists only for deploys
sudo mkdir -p /opt/leadpilot && sudo chown deploy:deploy /opt/leadpilot
sudo -iu deploy
ssh-keygen -t ed25519 -f ~/.ssh/github_read -N ""   # read-only key for cloning
cat ~/.ssh/github_read.pub
```

In GitHub: repository → **Settings → Deploy keys → Add deploy key**, paste that public key, leave **Allow write
access** off. Then, still as `deploy`:

```sh
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github_read
  IdentitiesOnly yes
EOF
ssh-keyscan github.com >> ~/.ssh/known_hosts
git clone git@github.com:amit101999/leadpilot-ai.git /opt/leadpilot
```

Create `/opt/leadpilot/.env` as in [Cloudflare Tunnel → 2](#2-configure-and-start) (`chmod 600 .env`) and add:

```sh
COMPOSE_FILE=docker-compose.yml:docker-compose.cloudflare.yml
COMPOSE_PROFILES=stack
```

**3. App tunnel.** Follow [Cloudflare Tunnel → 1](#1-create-the-tunnel-cloudflare-dashboard). For the first start, run
`scripts/deploy.sh "$(git rev-parse origin/main)"` as `deploy` in `/opt/leadpilot`, then seed once:
`docker compose run --rm migrate npm run db:seed`.

**4. SSH tunnel for GitHub Actions.** A second tunnel that runs on the host, not in Docker, so a broken app stack never
blocks the next deploy.

1. Zero Trust → **Networks → Tunnels → Create a tunnel** → name it `leadpilot-ssh`. Pick the Debian/Ubuntu install
   command shown there and run it on the server (installs `cloudflared` as a systemd service).
2. Public hostname: e.g. `ssh-leads.<your domain>`, Service type **SSH**, URL **`localhost:22`**.
3. Zero Trust → **Access → Service auth → Service tokens → Create**, name `github-deploy`. Copy the **Client ID** and
   **Client Secret** (the secret is shown once).
4. Zero Trust → **Access → Applications → Add → Self-hosted**: domain `ssh-leads.<your domain>`; one policy with action
   **Service Auth**, _Include → Service Token_ = `github-deploy`. Without this application anyone could reach your SSH
   port through the tunnel.

**5. Deploy key for GitHub Actions** (on your PC, not the server):

```sh
ssh-keygen -t ed25519 -f leadpilot_deploy -N "" -C github-deploy
```

On the server, as `deploy`, add one line to `~/.ssh/authorized_keys` (the public key, restricted to the deploy
script):

```
command="/opt/leadpilot/scripts/deploy.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA...your key... github-deploy
```

The server's host key for `known_hosts`, printed on the server:

```sh
for f in /etc/ssh/ssh_host_*_key.pub; do echo "ssh-leads.<your domain> $(cut -d' ' -f1,2 "$f")"; done
```

**6. GitHub settings.** Repository → **Settings → Secrets and variables → Actions**:

| Kind     | Name                      | Value                                               |
| -------- | ------------------------- | --------------------------------------------------- |
| Secret   | `DEPLOY_SSH_KEY`          | contents of the private key file `leadpilot_deploy` |
| Secret   | `SSH_KNOWN_HOSTS`         | the lines printed in step 5                         |
| Secret   | `CF_ACCESS_CLIENT_ID`     | service token Client ID                             |
| Secret   | `CF_ACCESS_CLIENT_SECRET` | service token Client Secret                         |
| Variable | `DEPLOY_SSH_HOST`         | `ssh-leads.<your domain>`                           |
| Variable | `DEPLOY_ENABLED`          | `true` (only once everything above works)           |

Then delete `leadpilot_deploy` from your PC. Push a commit to `main` and watch **Actions**.

### Cost

| Item                                  | Cost                                                                                                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub repository and Actions         | Free. Private repositories get 2,000 Linux runner minutes a month; one push to `main` uses roughly 12–18 (each job counts).                                      |
| Cloudflare DNS, HTTPS, Tunnel, Access | Free plan (Access free up to 50 users). Zero Trust sign-up may ask for a card; the Free plan charges nothing.                                                    |
| Domain                                | About $10–15 a year; required for a Tunnel.                                                                                                                      |
| Server                                | $0 on Oracle Cloud Always Free (card needed for sign-up; capacity is not guaranteed and idle instances can be reclaimed), or about $5–8 a month for a small VPS. |

Prices as of 2026-11; check the providers' pages. Not part of CI/CD but billed by use: OpenAI and
the SMTP provider.

Free-plan limit: GitHub branch protection on a private repository needs a paid plan, so GitHub cannot stop a direct
push to `main`. The deploy still runs only after every check passes.

### Troubleshooting CI/CD

- `deploy` skipped: `DEPLOY_ENABLED` is not `true`, the run is a pull request, or a check failed.
- "DEPLOY_SSH_HOST is not set" (or another name): add the secret/variable in step 6.
- `Host key verification failed`: `SSH_KNOWN_HOSTS` does not match the server or uses another hostname than
  `DEPLOY_SSH_HOST`.
- `websocket: bad handshake` or a 403 from cloudflared: the service token is wrong, or the Access application's policy
  is not **Service Auth** with that token.
- `Permission denied (publickey)`: the `authorized_keys` line is missing or belongs to another user than `deploy`.
- "tracked files were changed on the server": someone edited files in `/opt/leadpilot`; `git status`, then move the
  change into the repository (configuration belongs in `.env`).
- "another deploy is running": a previous deploy still holds `.deploy.lock` (it is released when that process ends).
- Health timeout: read the printed `migrate`/`web` logs; on a 2 GB server the build may be slow or killed for lack of
  memory (add swap).

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
- Cloudflare Tunnel mode publishes no port at all. Caddy trusts `CF-Connecting-IP` only from private (Docker network)
  addresses, which only `cloudflared` can use, and replaces `X-Forwarded-For` and `X-Real-IP` with that address before
  the app sees them. Cloudflare appends to a client-sent `X-Forwarded-For`, so its first entry must never be passed
  through. In this mode clients keep their real addresses for rate limiting on Docker Desktop too.
- `CLOUDFLARE_TUNNEL_TOKEN` lets anyone run your tunnel: treat it like a password and refresh it in the Cloudflare
  dashboard if it leaks.
- CI/CD ([above](#cicd)): GitHub holds only deploy credentials, never application secrets. The GitHub Actions key can
  only run `scripts/deploy.sh` (forced command, no forwarding, no terminal), and the script only deploys commits that
  are already on `main`. The SSH hostname is closed to everyone without the Access service token. The `deploy` user is
  in the `docker` group, which is root-equivalent, so the remaining risk is anyone who can **push to `main`**: their
  code runs in production after the checks pass. Keep GitHub access to people you trust and turn on two-factor
  authentication for the account. Workflow actions are pinned to commit SHAs and the `cloudflared` download is checked
  against its SHA-256.

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

### Cloudflare Tunnel (2026-11-11)

| Check                                                                                                                         | Result                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `docker compose ... -f docker-compose.cloudflare.yml --profile stack config` with test values                                 | ✅ valid; no service publishes a port                                  |
| `APP_BASE_URL` of `web` is `https://APP_DOMAIN`; e-mail settings reach the containers                                         | ✅                                                                     |
| Missing `CLOUDFLARE_TUNNEL_TOKEN`                                                                                             | ✅ Compose refuses to start with "Set CLOUDFLARE_TUNNEL_TOKEN in .env" |
| `docker-compose.prod.yml` still valid                                                                                         | ✅                                                                     |
| `caddy validate` of `deploy/Caddyfile.cloudflare` (Caddy 2.11.7)                                                              | ✅                                                                     |
| Caddy in front of an echo backend: request with `CF-Connecting-IP: 203.0.113.9` and a spoofed `X-Forwarded-For` / `X-Real-IP` | ✅ backend received only `203.0.113.9` in both headers                 |
| `POST /api/internal/...` through that Caddy                                                                                   | ✅ 404; HSTS set, `Server` removed                                     |
| `cloudflare/cloudflared:2026.10.1` runs; an invalid token is rejected                                                         | ✅                                                                     |

Not verified: a real tunnel with a real token and domain, Cloudflare Access with the import bypass, and a full stack
build in this mode (the development PC lacked free memory for the image build).

### CI/CD (2026-11-14)

| Check                                                                                                                                                                     | Result                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `actionlint` 1.7.7 on `.github/workflows/ci.yml` (includes shellcheck of every `run` step)                                                                                | ✅                              |
| `shellcheck` 0.10.0 on `scripts/deploy.sh`                                                                                                                                | ✅                              |
| `deploy.sh` in a Debian 12 container with a stubbed `docker`: malformed SHA (`main; rm -rf /`), unknown commit, commit not on `main`, edited tracked file, concurrent run | ✅ all refused, nothing changed |
| Same: first deploy (no Postgres, backup skipped), redeploy (backup taken), `.deployed-sha` written                                                                        | ✅                              |
| Same: `compose up` failing, `migrate` exiting 1, `web` unhealthy, health timeout                                                                                          | ✅ exit 1 with diagnostics      |
| `docker compose config` for base, prod and cloudflare files with placeholder values                                                                                       | ✅                              |

Not verified: a run on GitHub's runners, a real deploy over the SSH tunnel and Access service token, and `deploy.sh`
against a real Docker stack on a Linux server. These need the domain and server from [One-time setup](#one-time-setup).

## Troubleshooting

- `migrate` exits non-zero: `docker compose logs migrate`. Usually a wrong `POSTGRES_PASSWORD` for an existing volume
  (the password is fixed when the volume is first created).
- `n8n-import` exits non-zero: `N8N_ENCRYPTION_KEY` or `N8N_WEBHOOK_SECRET` is missing, or the key was changed after
  n8n first started (n8n cannot decrypt its stored credential).
- 403 on every form: `APP_BASE_URL` does not match the address in the browser (CSRF origin check).
- Caddy cannot get a certificate: check DNS and that ports 80/443 reach the server; `docker compose logs caddy`.
- Cloudflare Tunnel shows **Down** or the site answers Cloudflare error 1033: `docker compose logs cloudflared`
  ("Provided Tunnel token is not valid" means `CLOUDFLARE_TUNNEL_TOKEN` is wrong). Error 502: the public hostname's
  service is not `HTTP` + `caddy:80`, or `web` is not running (`docker compose ps`).
- The Upwork sync gets HTML or 403 instead of JSON from the public URL: Cloudflare Access or Bot Fight Mode is
  stopping the script; see [Optional: Cloudflare Access](#optional-cloudflare-access).
- Docker Desktop on Windows: builds need several GB on drive C:. When C: filled up during development, Docker's data
  disk went read-only and the engine hung; freeing space, quitting Docker Desktop completely and running
  `wsl --shutdown` before starting it again recovered it with data intact.
