import type {
  MessageKind,
  OutboundMessage,
  ProviderConnection,
  SendOutcome,
  WhatsAppProvider,
} from "./provider";

export interface CloudWhatsAppConfig {
  accessToken?: string;
  phoneNumberId?: string;
  graphApiVersion: string;
  language: string;
  templates: Partial<Record<MessageKind, string>>;
  timeoutMs: number;
}

const GRAPH_HOST = "https://graph.facebook.com";

/**
 * WhatsApp Business Cloud API adapter. Business-initiated messages are sent as
 * pre-approved templates (free-form text is only allowed inside a customer
 * service window, which this application cannot rely on).
 *
 * The only outbound host is graph.facebook.com; the path is built from
 * configuration validated at startup, never from user input (SSRF).
 */
export class CloudWhatsAppProvider implements WhatsAppProvider {
  readonly id = "cloud";
  readonly isMock = false;

  constructor(
    private readonly config: CloudWhatsAppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private missingConfig(): string[] {
    return [
      !this.config.accessToken && "WHATSAPP_ACCESS_TOKEN",
      !this.config.phoneNumberId && "WHATSAPP_PHONE_NUMBER_ID",
      !this.config.templates.lead && "WHATSAPP_TEMPLATE_NAME",
    ].filter((v): v is string => Boolean(v));
  }

  async checkConnection(): Promise<ProviderConnection> {
    const missing = this.missingConfig();
    if (missing.length > 0) {
      return { state: "NOT_CONFIGURED", message: "WhatsApp Cloud API is not fully configured", missing };
    }
    try {
      const response = await this.fetchImpl(
        `${GRAPH_HOST}/${this.config.graphApiVersion}/${encodeURIComponent(this.config.phoneNumberId!)}?fields=verified_name,quality_rating`,
        {
          headers: { Authorization: `Bearer ${this.config.accessToken}` },
          signal: AbortSignal.timeout(this.config.timeoutMs),
        },
      );
      if (response.ok) return { state: "CONNECTED", message: "WhatsApp Cloud API credentials accepted" };
      if (response.status === 401 || response.status === 403) {
        return {
          state: "NOT_AUTHORIZED",
          message: `WhatsApp Cloud API rejected the credentials (HTTP ${response.status})`,
        };
      }
      return { state: "UNAVAILABLE", message: `WhatsApp Cloud API returned HTTP ${response.status}` };
    } catch {
      return { state: "UNAVAILABLE", message: "WhatsApp Cloud API could not be reached" };
    }
  }

  async send(message: OutboundMessage): Promise<SendOutcome> {
    const missing = this.missingConfig();
    if (missing.length > 0) {
      return {
        kind: "rejected",
        retryable: false,
        httpStatus: null,
        error: `Not configured: ${missing.join(", ")}`,
      };
    }
    const template = this.config.templates[message.kind];
    if (!template) {
      return {
        kind: "rejected",
        retryable: false,
        httpStatus: null,
        error: `No template configured for ${message.kind} messages`,
      };
    }
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: message.to.replace(/^\+/, ""),
      type: "template",
      template: {
        name: template,
        language: { code: this.config.language },
        components:
          message.templateParams.length > 0
            ? [{ type: "body", parameters: message.templateParams.map((text) => ({ type: "text", text })) }]
            : [],
      },
      ...(message.callbackData ? { biz_opaque_callback_data: message.callbackData } : {}),
    };

    let response: Response;
    try {
      response = await this.fetchImpl(
        `${GRAPH_HOST}/${this.config.graphApiVersion}/${encodeURIComponent(this.config.phoneNumberId!)}/messages`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${this.config.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.timeoutMs),
        },
      );
    } catch (error) {
      return classifyTransportError(error);
    }

    const payload = (await response.json().catch(() => null)) as {
      messages?: Array<{ id?: string }>;
      error?: { code?: number; message?: string };
    } | null;

    if (response.ok) {
      const id = payload?.messages?.[0]?.id;
      // 2xx without a message id: we cannot prove acceptance or rejection.
      return id
        ? { kind: "accepted", providerMessageId: id, httpStatus: response.status }
        : { kind: "uncertain", error: `HTTP ${response.status} without message id` };
    }
    const providerCode = payload?.error?.code;
    const error = `WhatsApp API error HTTP ${response.status}${providerCode ? ` (code ${providerCode})` : ""}`;
    // 429 / 5xx: the provider did not process the message; safe to retry with backoff.
    const retryable = response.status === 429 || response.status >= 500;
    return { kind: "rejected", retryable, httpStatus: response.status, error };
  }
}

/**
 * Connection failures that happen before the request is written (DNS, refused)
 * are safely retryable; timeouts and resets may have reached the provider and
 * are therefore uncertain.
 */
function classifyTransportError(error: unknown): SendOutcome {
  const code = (error as { cause?: { code?: string } })?.cause?.code;
  if (code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "EAI_AGAIN") {
    return {
      kind: "rejected",
      retryable: true,
      httpStatus: null,
      error: `Connection failed before sending (${code})`,
    };
  }
  const name = (error as { name?: string })?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    return { kind: "uncertain", error: "Request timed out; the message may have been sent" };
  }
  return {
    kind: "uncertain",
    error: `Connection interrupted (${code ?? name ?? "unknown"}); the message may have been sent`,
  };
}
