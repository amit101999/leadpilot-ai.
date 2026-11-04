import type { ProviderConnection, SendOutcome } from "./provider";

export interface OutboundEmail {
  /** Recipient address. Only ever held in memory for the duration of the call. */
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Sent as the Message-ID local part so a retried send is recognisable in mail logs. */
  idempotencyKey: string;
}

/**
 * E-mail delivery, classified like WhatsApp sends so the same retry rules apply:
 * accepted (the server took the message), rejected (definitely not sent), or
 * uncertain (the connection broke after the message may have been handed over).
 */
export interface EmailProvider {
  readonly id: string;
  readonly isMock: boolean;
  checkConnection(): Promise<ProviderConnection>;
  send(message: OutboundEmail): Promise<SendOutcome>;
}
