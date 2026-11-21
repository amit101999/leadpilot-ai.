# Troubleshooting

Every API error carries a `requestId`; search the server logs for it (`request_id` field) to find the cause. For
production (Render, Neon) problems see also [deployment.md](deployment.md#troubleshooting).

## Setup and development

| Symptom                                                       | Cause and fix                                                                                                                             |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| App refuses to start with "Invalid environment configuration" | A required variable is missing or invalid; the message names it. Compare `.env` with `.env.example`                                       |
| Every form submission fails with 403 `CSRF_REJECTED`          | The browser address differs from `APP_BASE_URL` (including the port, e.g. `localhost:3200` vs `3000`). Make them match                    |
| `ECONNREFUSED 127.0.0.1:55432`                                | Postgres is not running: `docker compose up -d postgres`                                                                                  |
| Integration or e2e tests refuse to start                      | `TEST_DATABASE_URL` is missing or equals `DATABASE_URL` (the tests truncate every table)                                                  |
| `next build` (Turbopack) fails in a git worktree              | Turbopack refuses a `node_modules` that is a link outside the project. Run `npm ci` in the worktree, or build with `next build --webpack` |
| Port 3000 already in use                                      | Another dev server is running. Stop it or start on another port and set `APP_BASE_URL` to match                                           |
| Seed says the admin exists but the password does not work     | The seed never resets an existing password. Change it in Settings, or update the hash in the database                                     |

## Runs

| Symptom                              | Cause and fix                                                                                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run ends as `BLOCKED_SOURCE`         | The job source reported it is not usable. With the import source this should not happen; check the Integrations page and the run's error                                                              |
| A manual run finds no jobs           | Runs process only jobs the Upwork sync delivered for that profile. Check the profile's sync panel (last sync, problems) and that the cloud routine is running ([upwork-sync.md](upwork-sync.md))      |
| 409 `RUN_ALREADY_ACTIVE`             | The profile already has a queued or running run. Wait, or cancel it                                                                                                                                   |
| Run stays `RUNNING` with no progress | The server restarted during the run (for example a deploy or Render's free plan sleeping). After the lease expires (`RUN_LEASE_SECONDS`, default 300 s) use **Resume** or `POST /api/runs/:id/resume` |
| Many jobs end as `AI_ERROR`          | The AI returned invalid output or timed out after `maxRetries`. Check the Integrations page and `OPENAI_MODEL` / `OPENAI_TIMEOUT_MS`                                                                  |
| Nothing qualifies                    | Usually hard filters: budget minimum, fixed-price only and payment verification are strict by default. The job detail page lists each failed check                                                    |

## E-mail alerts

| Symptom                              | Cause and fix                                                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| No alerts sent                       | E-mail alerts are off on the profile, no e-mail recipient is selected, or the recipient's opt-in is not confirmed                        |
| Alerts fail with `NOT_CONFIGURED`    | E-mail settings are missing: `EMAIL_PROVIDER=brevo` with `BREVO_API_KEY` and `EMAIL_FROM`, or `smtp` with the `SMTP_*` values            |
| `FAILED_PERMANENT`, login/auth error | Wrong `SMTP_USER` / `SMTP_PASSWORD`. For Gmail use an app password (Google account → Security → App passwords), not the account password |
| `SENT` but not in the inbox          | The server accepted it; check the spam folder and that `EMAIL_FROM` matches the SMTP account                                             |
| `UNCERTAIN`                          | The connection dropped mid-send. It may have arrived; after 15 minutes an operator can retry with confirmation                           |
| Integrations shows `NOT_CONFIGURED`  | The listed variables are missing; the message names them                                                                                 |

## Sign-in

| Symptom                                               | Cause and fix                                                                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 429 on login                                          | 10 attempts per 15 minutes per IP and per e-mail. Wait for the `Retry-After` time                                           |
| Signed out unexpectedly                               | The session expired (`SESSION_TTL_HOURS`), the password was changed elsewhere, or the account was disabled                  |
| Behind a proxy, all users share one rate-limit bucket | The app reads the client IP from the first `X-Forwarded-For` entry. If a proxy does not set it, every client looks the same |
