import nodemailer, { type Transporter } from "nodemailer";
import { sanitizeErrorMessage } from "@/lib/security/sanitize";
import type { EmailProvider, OutboundEmail } from "./email-provider";
import type { ProviderConnection, SendOutcome } from "./provider";

export interface SmtpConfig {
  host?: string;
  port: number;
  /** true = TLS from the start (port 465); false = STARTTLS upgrade when offered (587). */
  secure: boolean;
  user?: string;
  password?: string;
  from?: string;
  timeoutMs: number;
}

interface SmtpError {
  code?: string;
  responseCode?: number;
  message?: string;
}

/** SMTP delivery through any mail server (Gmail app password, Zoho Mail, a domain mailbox...). */
export class SmtpEmailProvider implements EmailProvider {
  readonly id = "smtp";
  readonly isMock = false;
  private transporter: Transporter | null = null;

  constructor(
    private readonly config: SmtpConfig,
    private readonly createTransport: typeof nodemailer.createTransport = nodemailer.createTransport,
  ) {}

  private missingConfig(): string[] {
    return [
      !this.config.host && "SMTP_HOST",
      !this.config.from && "EMAIL_FROM",
      this.config.user && !this.config.password && "SMTP_PASSWORD",
    ].filter((v): v is string => Boolean(v));
  }

  private getTransporter(): Transporter {
    this.transporter ??= this.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: this.config.user ? { user: this.config.user, pass: this.config.password } : undefined,
      connectionTimeout: this.config.timeoutMs,
      greetingTimeout: this.config.timeoutMs,
      socketTimeout: this.config.timeoutMs,
    });
    return this.transporter;
  }

  async checkConnection(): Promise<ProviderConnection> {
    const missing = this.missingConfig();
    if (missing.length > 0) {
      return { state: "NOT_CONFIGURED", message: "SMTP e-mail is not fully configured", missing };
    }
    try {
      await this.getTransporter().verify();
      return { state: "CONNECTED", message: `SMTP server ${this.config.host} accepted the connection` };
    } catch (error) {
      const e = error as SmtpError;
      if (e.code === "EAUTH") return { state: "NOT_AUTHORIZED", message: "SMTP server rejected the login" };
      return { state: "UNAVAILABLE", message: `SMTP server could not be reached (${e.code ?? "error"})` };
    }
  }

  async send(message: OutboundEmail): Promise<SendOutcome> {
    const missing = this.missingConfig();
    if (missing.length > 0) {
      return { kind: "rejected", retryable: false, httpStatus: null, error: `Not configured: ${missing.join(", ")}` };
    }
    try {
      const info = await this.getTransporter().sendMail({
        from: this.config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        messageId: `<${message.idempotencyKey}@leadpilot.local>`,
      });
      const accepted = (info.accepted ?? []).length > 0;
      return accepted
        ? { kind: "accepted", providerMessageId: String(info.messageId), httpStatus: null }
        : { kind: "rejected", retryable: false, httpStatus: null, error: "SMTP server refused the recipient" };
    } catch (error) {
      return classifySmtpError(error as SmtpError);
    }
  }
}

/**
 * SMTP reply codes decide retry safety: 5xx is permanent, 4xx is a temporary refusal (nothing was
 * accepted). Failing to connect at all is safe to retry; a connection lost later may have delivered.
 */
export function classifySmtpError(error: SmtpError): SendOutcome {
  const detail = sanitizeErrorMessage(error.message ?? "SMTP error");
  if (error.responseCode && error.responseCode >= 500) {
    return { kind: "rejected", retryable: false, httpStatus: null, error: `SMTP ${error.responseCode}: ${detail}` };
  }
  if (error.responseCode && error.responseCode >= 400) {
    return { kind: "rejected", retryable: true, httpStatus: null, error: `SMTP ${error.responseCode}: ${detail}` };
  }
  if (error.code === "EAUTH" || error.code === "EENVELOPE" || error.code === "EMESSAGE") {
    return { kind: "rejected", retryable: false, httpStatus: null, error: `SMTP ${error.code}: ${detail}` };
  }
  if (error.code === "ECONNECTION" || error.code === "EDNS") {
    return { kind: "rejected", retryable: true, httpStatus: null, error: `SMTP connection failed (${error.code})` };
  }
  return { kind: "uncertain", error: `SMTP connection interrupted (${error.code ?? "unknown"}); the e-mail may have been sent` };
}
