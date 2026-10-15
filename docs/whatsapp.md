# WhatsApp alerts

LeadPilot sends qualified leads to WhatsApp through the **WhatsApp Business Cloud API** (Meta). By default it uses a
mock provider that records messages without sending anything (`WHATSAPP_PROVIDER=mock`).

Code: `src/modules/notifications/` (`cloud-whatsapp.ts` adapter, `message.ts` templates, `service.ts` delivery,
`webhook.ts` status updates). Verified with mocked HTTP only; never run against a real Meta account.

## Why templates

Business-initiated messages outside a 24-hour customer-service window must use a **pre-approved message template**.
LeadPilot cannot rely on such a window, so every message is a template with body parameters `{{1}}`, `{{2}}`, …. Free
text is never sent.

## Setup

1. In Meta Business Manager, create a WhatsApp Business account and app. Under **WhatsApp → API setup**, note the
   **phone number ID** (not the phone number) and create a **system-user access token** with WhatsApp permissions.
2. Create and get approval for these templates (category: utility), in the language you set as
   `WHATSAPP_TEMPLATE_LANGUAGE` (default `en_US`):

   **Lead alert** (`WHATSAPP_TEMPLATE_NAME`), 9 body parameters, in this order:

   | Param   | Content                                       | Max length |
   | ------- | --------------------------------------------- | ---------- |
   | `{{1}}` | Job title                                     | 200        |
   | `{{2}}` | Budget (e.g. `USD 800` or a range)            | 60         |
   | `{{3}}` | Job type (`Fixed price`, `Hourly`, `Unknown`) | 20         |
   | `{{4}}` | Payment verified (`Yes`, `No`, `Unknown`)     | 10         |
   | `{{5}}` | Matched skills                                | 200        |
   | `{{6}}` | AI match score (`88/100`)                     | 10         |
   | `{{7}}` | Reason (80 characters in the compact format)  | 300        |
   | `{{8}}` | Risk flags or `None`                          | 200        |
   | `{{9}}` | Job URL                                       | 500        |

   **Run summary** (`WHATSAPP_SUMMARY_TEMPLATE_NAME`, optional), 7 parameters: status, jobs discovered, qualified,
   rejected, alerts sent, delivery failures, run URL.

   **Connection test** (`WHATSAPP_TEST_TEMPLATE_NAME`, default `hello_world`, which Meta provisions on new accounts),
   no parameters.

   Parameters never contain newlines, tabs or more than one consecutive space (Meta rejects them); empty values are
   sent as `-`.

3. Set `WHATSAPP_PROVIDER=cloud`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` and the template names in `.env`.
   `WHATSAPP_GRAPH_API_VERSION` defaults to `v21.0`.
4. **Status webhook**: in the Meta app, subscribe the `messages` field to `https://<APP_DOMAIN>/api/webhooks/whatsapp`
   with a verify token equal to `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. Set `WHATSAPP_APP_SECRET` to the app secret: every
   webhook POST is refused without a valid `X-Hub-Signature-256`.
5. Add a recipient in **Settings**, confirm that the person agreed to receive messages, enable WhatsApp on a profile,
   and use **Integrations → Send test message**.

## Delivery lifecycle

```
RESERVED ─claim─► SENDING ─accepted─► SENT ─webhook─► DELIVERED ─► READ
                     │
                     ├─rejected (429, 5xx, refused)─► FAILED_RETRYABLE ─automatic, 2 s × 2ⁿ (max 30 s)─► SENDING
                     │                                   after 3 attempts ─► FAILED_PERMANENT
                     ├─rejected (other 4xx, config)─► FAILED_PERMANENT ─manual retry─► SENDING
                     └─timeout / reset / 2xx without id─► UNCERTAIN
                            ├─webhook with biz_opaque_callback_data ─► SENT/DELIVERED/READ (reconciled, audited)
                            └─after 15 min + "recipient did not get it" confirmation ─► manual retry
```

- Each send carries an idempotency key and `biz_opaque_callback_data` (an internal notification reference with no
  personal data), so a status webhook can match a send whose HTTP response was lost.
- Webhook updates only move a notification forward (a late `sent` after `read` is ignored).
- **Guarantee**: at most one alert per (job, channel, recipient), enforced by a unique index, with reconciliation of
  ambiguous sends. Not exactly-once: an `UNCERTAIN` send that is manually retried after confirmation could, in theory,
  be delivered twice if Meta had in fact delivered the first one and never reported it.
- The per-run limit (`maxPerRun`, 1–50) counts lead alerts only; the run summary is a separate message.

## Not implemented

Incoming messages and replies, media messages, multiple WhatsApp numbers per installation, and automatic template
creation.
