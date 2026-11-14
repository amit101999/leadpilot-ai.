# Security

What protects LeadPilot today, where it lives in the code, and the risks that remain. Infrastructure-level controls
(ports, Caddy, secrets on the server) are in [deployment.md](deployment.md#security-notes).

## Trust boundaries

| Boundary                            | Who is on the other side                                              | Control                                                                                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser → app                       | Signed-in users (and anyone online)                                   | Session cookie, roles, per-user ownership checks, same-origin check, rate limits                                                                                                      |
| n8n → `/api/internal/*`             | The n8n container                                                     | HMAC-SHA256 signature with timestamp (`INTERNAL_API_SECRET`); Caddy blocks the path from outside                                                                                      |
| App → n8n webhook                   | n8n                                                                   | Shared header secret (`N8N_WEBHOOK_SECRET`) checked by an n8n credential                                                                                                              |
| App → OpenAI / SMTP server          | External APIs                                                         | Fixed hosts from configuration, never from user input; timeouts; sanitized errors                                                                                                     |
| Job source data → app               | Untrusted job text                                                    | Normalized and validated; shown via React (escaped); sent to the AI as data only                                                                                                      |
| Upwork sync agent → `/api/import/*` | Claude Code on the operator's PC, or a Claude cloud routine (planned) | Per-user import token (HMAC-stored, revocable, rate limited); acts with that user's role and ownership; every job re-validated with zod; links restricted to `https://www.upwork.com` |
| Upwork job text → agent             | Strangers writing job posts                                           | Agent instructions forbid following instructions in job text; `--allowedTools` limits it to read-only Upwork calls, the import script and `.upwork-sync/`                             |
| App → SMTP server                   | Your mail provider                                                    | Server, sender and login from configuration only; timeouts; errors sanitized; job text HTML-escaped in alerts                                                                         |

## Controls

**Authentication and sessions** (`src/lib/auth`, `src/modules/auth`)

- Passwords are hashed with argon2id (19 MiB, 2 passes, parallelism 1). Minimum length 12. Unknown e-mails are
  checked against a dummy hash so response timing does not reveal which accounts exist; the error is the same generic 401.
- Session tokens are 256-bit random values. The database stores only an HMAC-SHA256 of the token (keyed with
  `AUTH_SECRET`), so a database leak does not yield usable sessions. Cookie: `__Host-` prefix, HttpOnly, Secure,
  SameSite=Lax. Disabled users lose access immediately (checked on every lookup). Changing a password ends the user's
  other sessions.
- Login is rate limited per IP and per (hashed) e-mail; password change per user.

**Authorization**

- Every API route declares its minimum role (`userRoute("VIEWER" | "OPERATOR" | "ADMIN", …)`); services check it again.
- Ownership is enforced in queries: another user's profile, run, job, lead, notification or recipient returns 404.
  Covered by integration tests (acceptance #17).
- Page access: `src/proxy.ts` redirects signed-out requests to `/login`; the `?next=` target is validated against open
  redirects (`safeNextPath`).

**Input and output**

- All request bodies, queries and path parameters are validated with zod; bodies are capped at 256 KB. Profile
  configuration is validated on the server, not only in the form.
- SQL is built with Drizzle's parameterized queries. `LIKE` search input is escaped (`escapeLike`).
- React escapes all rendered text; the code contains no `dangerouslySetInnerHTML`.
- CSV exports neutralize formula injection (`=`, `+`, `-`, `@`, tab, carriage return) and quote special characters.
- Alert e-mails: job text is shortened to single lines (no header injection through the subject) and HTML-escaped;
  only `http(s)` links become clickable (`src/modules/notifications/message.ts`).
- Job URLs must be `https` on the source's own hosts; others are rejected by the hard filters.

**CSRF and headers**

- State-changing requests must send an `Origin` equal to `APP_BASE_URL` (fail closed when missing), plus SameSite=Lax
  cookies.
- Response headers (`next.config.ts`): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone, geolocation off),
  no `X-Powered-By`. Caddy adds HSTS in production.

**Secrets and logging**

- Configuration comes from the environment and is validated at startup (`src/lib/configuration/env.ts`); errors name
  the variable, never its value.
- pino redacts passwords, tokens, access tokens, authorization headers and cookies by path. Provider errors are passed
  through `sanitizeErrorMessage` before storage, which removes tokens, e-mails and phone numbers.
- Recipient phone numbers and e-mail addresses are never returned in full by the API (masked) and never logged.
- Lead e-mails escape every job-supplied value in the HTML body and keep the subject on one line, so job text cannot
  inject markup or mail headers; only `http(s)` links become clickable.
- Import tokens (`lpi_` + 32 random bytes) are shown once, stored as an HMAC (separate from session hashing), and
  checked on every request together with the user's status.
- OpenAI requests use `store: false`. The model receives only the job and a minimal profile slice: skill names,
  category and risk sensitivity.

**Abuse and side effects**

- Rate limits on login, password change, run start, retries, test e-mails and exports ([api.md](api.md#rate-limits)).
- Idempotency keys on run creation; one active run per profile; alert uniqueness per job and recipient in the
  database; uncertain e-mail sends are never retried automatically.
- Alert e-mails go only to recipients whose opt-in was explicitly confirmed.

**Audit trail**

- Logins, profile changes, runs, retries, recipient changes, integration tests and webhook reconciliations are written
  to `audit_logs` with actor, request id and before/after state. Only ADMINs can read it.

## Known risks and limitations

| Risk                                                                                                                                                 | Impact                                                                                                      | Mitigation / next step                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No Content-Security-Policy header                                                                                                                    | Less defence in depth if an XSS bug were ever introduced                                                    | No XSS sink is known. Add a nonce-based CSP (Next.js supports it via the proxy)                                                                                                                                                                                 |
| n8n has `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`                                                                                                         | Anyone with n8n editor access can read n8n's secrets                                                        | Editor never published in production; treat editor access as secret access                                                                                                                                                                                      |
| `clientIp` trusts `X-Forwarded-For`                                                                                                                  | Without Caddy in front, clients could choose their rate-limit bucket                                        | Production always runs behind Caddy, which overwrites the header (with the peer address, or with `CF-Connecting-IP` in Cloudflare Tunnel mode); local stack is bound to 127.0.0.1                                                                               |
| Dev-only dependency advisories (`npm audit`: 5 high, 4 moderate, all in `eslint-config-next` and `drizzle-kit` chains; 0 in production dependencies) | Affect linting/migration tooling, not the running server                                                    | Fix requires major-version changes (`npm audit fix --force`); revisit when upstream releases fixes                                                                                                                                                              |
| No account lockout or MFA                                                                                                                            | Online guessing limited only by rate limits                                                                 | Rate limits per IP and e-mail; strong password minimum                                                                                                                                                                                                          |
| No user-management UI or API                                                                                                                         | Users are created with the seed or SQL                                                                      | Documented; out of scope so far                                                                                                                                                                                                                                 |
| Data kept indefinitely                                                                                                                               | Job text, audit logs and phone numbers accumulate                                                           | Define a retention policy before real production data                                                                                                                                                                                                           |
| Live OpenAI scoring and lead e-mails not yet exercised in a run                                                                                      | Only the OpenAI key (one test request) and SMTP login/test e-mail were checked live                         | Run one manual sync with real providers and check the scores and the inbox                                                                                                                                                                                      |
| Upwork sync depends on Upwork's terms                                                                                                                | Scheduled searching may count as "continuous monitoring"                                                    | Scheduled syncs disabled until `UPWORK_SYNC_SCHEDULED_ALLOWED=true`; the operator decides                                                                                                                                                                       |
| A stolen import token can inject jobs for its user's profiles                                                                                        | Fake jobs could trigger alerts (no data is read or deleted)                                                 | Revoke in Settings; tokens are kept only in `.env` on the sync PC or in the cloud routine's environment variables (one dedicated token per place); the import script sends them only over HTTPS (or to localhost); rate limited; actions audited                |
| Anyone who can push to `main` deploys to production (CI/CD)                                                                                          | Code runs on the server after the checks pass; the `deploy` user is in the `docker` group (root-equivalent) | GitHub holds no app secrets; the deploy key is limited to `scripts/deploy.sh`, which only deploys commits on `main`; SSH is reachable only through Cloudflare Access with a service token. Keep repository access small and use 2FA (docs/deployment.md, CI/CD) |

The final review on 2026-10-15 was a manual pass over the code against the CLAUDE.md §4 checklist, plus `npm audit`
and the full test suites. It is not a penetration test or a third-party audit.

On 2026-11-04 `npm audit --omit=dev` reported new advisories in production dependencies: Next.js 16.4.0 (critical:
remote code execution in image optimization with SVG and in `use cache`, plus a Server Actions DoS) and zod 4.6.5
(high: memory exhaustion validating oversized collections). Both were patched in place (`next` 16.4.5, `zod` 4.6.7);
`npm audit --omit=dev` then reported 0 vulnerabilities.
