# n8n run workflow

LeadPilot can run a search in two ways, chosen by `RUN_EXECUTOR`:

- `inprocess` (default): the web app runs the pipeline itself after answering the request.
- `n8n`: the web app hands the run to n8n, and n8n drives it step by step.

n8n only orchestrates. Every business rule (discovery, filters, AI scoring, selection,
e-mail alerts) stays in the app behind the signed endpoint
`POST /api/internal/runs/:id/steps/:step`. Both executors call the same `runStep` function
(`src/modules/runs/engine/index.ts`), so a run behaves the same either way.

Workflow file: [`n8n/workflows/leadpilot-run.json`](../workflows/leadpilot-run.json)
Tested with: n8n `2.42.7` (Docker image `n8nio/n8n:2.42.7`).

## How a run flows

```
Web app                                n8n                                   Web app
POST /api/runs ──► dispatchRun ──► Webhook "Run requested"
  (src/modules/runs/executor.ts)       │ Header Auth: X-LeadPilot-Webhook-Secret
                                       │ replies 200 at once
                                       ▼
                                   Valid run id? (UUID) ── no ──► Ignore invalid request
                                       │ yes
                                       ▼
                         ┌──────► Build step request ─► Sign (HMAC-SHA256) ─► Run step ──► POST /api/internal/runs/:id/steps/:step
                         │                                                       │ ok             (signed, INTERNAL_API_SECRET)
                         │                                                       ▼
                         │                                                 Read step result
                         │                                                       │
                         │                     Run finished? ── yes ──► Done ◄───┘
                         │                         │ no
                         │                     Too many steps? (≥ 500) ── yes ──► Describe failure
                         │                         │ no
                         └── Wait (1–60 s) ◄── Wait requested? (retryAfterMs > 0)
                         └──────────────────────── no

Run step error (after 3 tries) ──► Run owned elsewhere? (LEASE_HELD) ── yes ──► Leave run to its owner
                                                              │ no
                                                              ▼
                                         Describe failure ─► Sign ─► Report failure ──► POST /api/internal/runs/:id/fail
```

The steps are `start → discover → filter → evaluate → select → notify → finalize`. The app
answers each call with `{ data: { next, terminal, retryAfterMs, runStatus } }`. Some steps run
in batches, so the same step can be called more than once. A mock run made 8 step calls.

## Security

| Direction | Check                                                                                                                                                 | Where                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| App → n8n | `X-LeadPilot-Webhook-Secret` header checked by n8n's **Header Auth** credential                                                                       | Webhook node                                                                                  |
| App → n8n | The run id must be a UUID before it is put in any URL                                                                                                 | `Valid run id?`                                                                               |
| n8n → app | `x-leadpilot-signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` with `INTERNAL_API_SECRET`. Signatures more than 5 minutes off are refused | Crypto nodes; verified by `internalRoute` (`src/lib/http/api.ts`, `src/lib/security/hmac.ts`) |
| n8n → app | Only one executor may drive a run. The lease owner is `n8n:<execution id>`                                                                            | `acquireLease` / `assertNoOtherLeaseHolder` (`src/modules/runs/engine/context.ts`)            |

The app also signs its webhook call (`X-LeadPilot-Signature`), but the workflow doesn't check
that signature. A replayed start request can't cause harm: steps are idempotent, and a second
execution can't take the lease from the first (see below).

Secrets are never stored in the workflow JSON. They come from n8n environment variables
(`{{ $env... }}`) and one n8n credential. `tests/unit/n8n-workflow.test.ts` checks this.

**Trade-off:** reading `$env` needs `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, which lets anyone who
can edit workflows in this n8n instance read its environment variables. That's acceptable
because n8n has a single owner account and the editor shouldn't be exposed publicly (see the
deployment notes in Phase E).

## Failure handling

- **A step call fails** (network error, 5xx, timeout after 5 minutes): n8n tries 3 times, 5 s
  apart (`retryOnFail`). n8n retries every error this way, including 4xx answers. If all 3
  tries fail, the error branch calls `/fail` with the step's stage and a shortened message.
  The app cleans up the message (`sanitizeErrorMessage`) and marks the run FAILED. Jobs,
  scores and alerts already saved are kept.
- **Another execution owns the run** (`409 LEASE_HELD`), for example when the same run is
  dispatched twice: the duplicate stops without reporting a failure. The app enforces this too.
  `/fail` refuses with 409 when a _different_ executor holds a live lease. Without an
  execution id, any live lease blocks the call. A duplicate therefore can never fail a healthy
  run.
- **More than 500 loop passes:** treated as a failure and reported through `/fail`.
- **n8n itself stops mid-run:** nothing calls `/fail`. The run stays RUNNING until its lease
  expires (`RUN_LEASE_SECONDS`, default 300). After that it can be continued with **Resume** on
  the run detail page.
- **Wrong `LEADPILOT_INTERNAL_API_SECRET`** (expected from the code, not tested): both the step
  call and `/fail` are refused with 401, so the run stays QUEUED. Cancel it, fix the secret
  and start again.

Why there's no separate Error Trigger workflow: the error workflow receives only the failed
execution's metadata, not the run id. The in-workflow error branch has the run id and the
current step, so it can report the right stage.

## Setup

With the Docker stack (`docker compose --profile stack up`), all of this is automatic: the
`n8n-import` service creates the credential from `N8N_WEBHOOK_SECRET`, imports the workflow and
publishes it on every start, and `docker-compose.yml` sets the variables below. See
[`docs/deployment.md`](../../docs/deployment.md). The steps here are for an n8n you run yourself.

### 1. Environment variables for n8n

| Variable                        | Value                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `LEADPILOT_APP_URL`             | App URL as n8n can reach it, e.g. `http://web:3000` in Docker Compose or `http://host.docker.internal:3000` for a local app |
| `LEADPILOT_INTERNAL_API_SECRET` | Same value as the app's `INTERNAL_API_SECRET`                                                                               |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE`  | `false` (see the trade-off above)                                                                                           |
| `N8N_ENCRYPTION_KEY`            | Long random value; n8n uses it to encrypt stored credentials. Keep it stable                                                |

### 2. App variables

`RUN_EXECUTOR=n8n`, `N8N_BASE_URL` (n8n URL as the app can reach it), `N8N_WEBHOOK_SECRET`,
`INTERNAL_API_SECRET`. `N8N_WEBHOOK_PATH` defaults to `/webhook/leadpilot-run`. See
`.env.example`.

### 3. Credential

Create a **Header Auth** credential called `LeadPilot webhook secret`:

- Name: `X-LeadPilot-Webhook-Secret`
- Value: the app's `N8N_WEBHOOK_SECRET`

The workflow refers to it by the id `leadpilotWebhookAuth`. If you create it in the UI, it
gets a different id, so open the **Run requested** node and select it.

Using the CLI instead, put this in a file (it contains the secret, so don't commit it) and
import it:

```json
[
  {
    "id": "leadpilotWebhookAuth",
    "name": "LeadPilot webhook secret",
    "type": "httpHeaderAuth",
    "data": { "name": "X-LeadPilot-Webhook-Secret", "value": "<N8N_WEBHOOK_SECRET>" }
  }
]
```

```sh
n8n import:credentials --input=/path/to/credentials.json
```

### 4. Import and publish the workflow

```sh
n8n import:workflow --input=/path/to/n8n/workflows/leadpilot-run.json
n8n publish:workflow --id=leadpilotRunFlow
# Changes made through the CLI take effect after n8n restarts.
```

In the editor you can instead use _Import from file_, select the credential on **Run
requested**, and publish. Re-importing the file updates the same workflow (`id:
leadpilotRunFlow`) and unpublishes it, so publish again afterwards.

### 5. Check it

- On the app's **Integrations** page, **Test connection** for n8n calls `N8N_BASE_URL/healthz`.
- Start a search. On the run detail page, the executor shows `n8n`.
- A call to the webhook without the header is answered with **403**.

## Verified behaviour

Checked on 2026-10-13 against `n8nio/n8n:2.42.7`, with the app built for production
(`next start`) on the test database and mock providers:

| Scenario                                            | Result                                                                                                                                                                                                          |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search started from the app with `RUN_EXECUTOR=n8n` | Reached `COMPLETED_WITH_ERRORS` in about 2–3 s through 8 step calls. "With errors" is expected: the mock fixtures deliberately include jobs with invalid AI output (`src/modules/job-sources/mock-fixtures.ts`) |
| Webhook called with a wrong secret                  | 403                                                                                                                                                                                                             |
| Run id `../../admin`                                | Stopped at `Valid run id?`; no call to the app                                                                                                                                                                  |
| Unknown run id                                      | Step call 404 → error branch → signed `/fail` call accepted by the app's signature check (answered 404 "Run not found")                                                                                         |
| Same run dispatched twice after it finished         | Duplicate made one call, got `terminal`, stopped                                                                                                                                                                |
| Duplicate while another executor holds the lease    | Step call 409 `LEASE_HELD` → **Leave run to its owner**; run stayed RUNNING with its original owner                                                                                                             |

Not verified: a real n8n crash mid-run followed by **Resume**, and runs against live
OpenAI/e-mail providers.

**Known quirk:** the webhook replies 200, not 202. Setting a custom response code
(`options.responseCode`) had no effect in 2.42.7. The app accepts any 2xx (`response.ok` in
`executor.ts`).
