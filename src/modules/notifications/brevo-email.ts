import { sanitizeErrorMessage } from "@/lib/security/sanitize";
import type { EmailProvider, OutboundEmail } from "./email-provider";
import type { ProviderConnection, SendOutcome } from "./provider";

const API_BASE = "https://api.brevo.com/v3";

export interface BrevoConfig {
  apiKey?: string;
  /** Sender, either "alerts@example.com" or "LeadPilot <alerts@example.com>". Must be a sender verified in Brevo. */
  from?: string;
  timeoutMs: number;
}

/**
 * E-mail over Brevo's HTTPS API. Used where outbound SMTP ports are blocked (e.g. Render's free plan).
 * Same outcome rules as SMTP: 4xx is a definite refusal, 429/5xx are retryable refusals, and a timeout or
 * dropped connection is uncertain because Brevo may already have accepted the message.
 */
export class BrevoEmailProvider implements EmailProvider {
  readonly id = "brevo";
  readonly isMock = false;

  constructor(
    private readonly config: BrevoConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private missingConfig(): string[] {
    return [!this.config.apiKey && "BREVO_API_KEY", !this.config.from && "EMAIL_FROM"].filter(
      (v): v is string => Boolean(v),
    );
  }

  private request(path: string, init: RequestInit = {}): Promise<Response> {
    return this.fetchImpl(`${API_BASE}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": this.config.apiKey ?? "",
      },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
  }

  async checkConnection(): Promise<ProviderConnection> {
    const missing = this.missingConfig();
    if (missing.length > 0) {
      return { state: "NOT_CONFIGURED", message: "Brevo e-mail is not fully configured", missing };
    }
    try {
      const response = await this.request("/account");
      if (response.ok) return { state: "CONNECTED", message: "Brevo accepted the API key" };
      if (response.status === 401 || response.status === 403) {
        return { state: "NOT_AUTHORIZED", message: "Brevo rejected the API key" };
      }
      return { state: "UNAVAILABLE", message: `Brevo responded with HTTP ${response.status}` };
    } catch {
      return { state: "UNAVAILABLE", message: "Brevo could not be reached" };
    }
  }

  async send(message: OutboundEmail): Promise<SendOutcome> {
    const missing = this.missingConfig();
    if (missing.length > 0) {
      return {
        kind: "rejected",
        retryable: false,
        httpStatus: null,
        error: `Not configured: ${missing.join(", ")}`,
      };
    }
    const sender = parseSender(this.config.from ?? "");
    if (!sender) {
      return {
        kind: "rejected",
        retryable: false,
        httpStatus: null,
        error: "EMAIL_FROM is not a valid address",
      };
    }
    let response: Response;
    try {
      response = await this.request("/smtp/email", {
        method: "POST",
        body: JSON.stringify({
          sender,
          to: [{ email: message.to }],
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
          headers: { "X-LeadPilot-Idempotency-Key": message.idempotencyKey },
        }),
      });
    } catch (error) {
      return classifyBrevoNetworkError(error);
    }
    return classifyBrevoResponse(response.status, await readBody(response));
  }
}

/** Accepts "a@b.c" or "Name <a@b.c>". */
export function parseSender(from: string): { email: string; name?: string } | null {
  const match = /^\s*(?:"?([^"<]*?)"?\s*<([^<>\s]+@[^<>\s]+)>|([^<>\s]+@[^<>\s]+))\s*$/.exec(from);
  if (!match) return null;
  const email = match[2] ?? match[3];
  if (!email) return null;
  const name = match[1]?.trim();
  return name ? { email, name } : { email };
}

async function readBody(response: Response): Promise<{ messageId?: unknown; message?: unknown } | null> {
  try {
    return (await response.json()) as { messageId?: unknown; message?: unknown };
  } catch {
    return null;
  }
}

export function classifyBrevoResponse(
  status: number,
  body: { messageId?: unknown; message?: unknown } | null,
): SendOutcome {
  if (status >= 200 && status < 300) {
    const id = typeof body?.messageId === "string" ? body.messageId : `brevo-${status}`;
    return { kind: "accepted", providerMessageId: id, httpStatus: status };
  }
  const detail = sanitizeErrorMessage(typeof body?.message === "string" ? body.message : `HTTP ${status}`);
  // Rate limited or a server-side failure: Brevo did not take the message, so it is safe to try again later.
  const retryable = status === 429 || status >= 500;
  return { kind: "rejected", retryable, httpStatus: status, error: `Brevo ${status}: ${detail}` };
}

/**
 * A request that never left (DNS failure, connection refused) is safe to retry. A timeout or a connection
 * dropped after sending may mean Brevo accepted the message, so it is uncertain and never retried automatically.
 */
export function classifyBrevoNetworkError(error: unknown): SendOutcome {
  const cause = (error as { cause?: { code?: string } })?.cause?.code;
  if (cause === "ENOTFOUND" || cause === "EAI_AGAIN" || cause === "ECONNREFUSED") {
    return {
      kind: "rejected",
      retryable: true,
      httpStatus: null,
      error: `Brevo could not be reached (${cause})`,
    };
  }
  const name = (error as { name?: string })?.name ?? "error";
  return { kind: "uncertain", error: `Brevo request interrupted (${name}); the e-mail may have been sent` };
}
