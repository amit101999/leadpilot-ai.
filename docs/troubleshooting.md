# Troubleshooting

Every API error carries a `requestId`; search the server logs for it (`request_id` field) to find the cause. For
Docker and production problems see also [deployment.md](deployment.md#troubleshooting).

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

| Symptom                                                                       | Cause and fix                                                                                                                                                  |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run ends as `BLOCKED_SOURCE`                                                  | The job source is not authorized. Expected with `JOB_SOURCE_PROVIDER=upwork` ([upwork-access.md](upwork-access.md)); use `mock`                                |
| 409 `RUN_ALREADY_ACTIVE`                                                      | The profile already has a queued or running run. Wait, or cancel it                                                                                            |
| Run stays `RUNNING` with no progress                                          | The executor stopped (server restart, n8n down). After the lease expires (`RUN_LEASE_SECONDS`, default 300 s) use **Resume** or `POST /api/runs/:id/resume`    |
| A new run is immediately `FAILED` with `EXECUTOR_UNAVAILABLE` (503 on Resume) | `RUN_EXECUTOR=n8n` but n8n is unreachable or `N8N_BASE_URL` / `N8N_WEBHOOK_SECRET` are missing. Start n8n or switch to `inprocess`                             |
| n8n answers 403 to the app                                                    | `N8N_WEBHOOK_SECRET` differs between the app and the n8n credential. In Docker, `n8n-import` re-creates it on start                                            |
| Steps fail with 401 `INVALID_SIGNATURE`                                       | `INTERNAL_API_SECRET` (app) and `LEADPILOT_INTERNAL_API_SECRET` (n8n) differ, or the clocks differ by more than 5 minutes (the signature's allowed clock skew) |
| Many jobs end as `AI_ERROR`                                                   | The AI returned invalid output or timed out after `maxRetries`. Check the Integrations page and `OPENAI_MODEL` / `OPENAI_TIMEOUT_MS`                           |
| Nothing qualifies                                                             | Usually hard filters: budget minimum, fixed-price only and payment verification are strict by default. The job detail page lists each failed check             |

## WhatsApp

| Symptom                             | Cause and fix                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| No alerts sent                      | WhatsApp is off on the profile, no recipient is selected, or the recipient's opt-in is not confirmed                                 |
| `FAILED_PERMANENT` with HTTP 400    | Template name, language or parameter count does not match the approved template ([whatsapp.md](whatsapp.md#setup))                   |
| `UNCERTAIN`                         | The request timed out or the connection dropped. Wait for a status webhook; after 15 minutes an operator can retry with confirmation |
| Webhook calls answer 401            | `WHATSAPP_APP_SECRET` is missing or wrong                                                                                            |
| Integrations shows `NOT_CONFIGURED` | The listed variables are missing; the message names them                                                                             |

## Sign-in

| Symptom                                               | Cause and fix                                                                                                                      |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 429 on login                                          | 10 attempts per 15 minutes per IP and per e-mail. Wait for the `Retry-After` time                                                  |
| Signed out unexpectedly                               | The session expired (`SESSION_TTL_HOURS`), the password was changed elsewhere, or the account was disabled                         |
| Behind a proxy, all users share one rate-limit bucket | The app reads the client IP from `X-Forwarded-For`, which Caddy sets. On Docker Desktop every client appears as the Docker gateway |
