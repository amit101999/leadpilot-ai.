export type MessageKind = "lead" | "summary" | "test";

export interface OutboundMessage {
  /** E.164 recipient number. Only ever held in memory for the duration of the call. */
  to: string;
  kind: MessageKind;
  /** Ordered body parameters for the approved template ({{1}}, {{2}}, ...). */
  templateParams: string[];
  /** Human-readable rendering stored for the UI (contains no phone numbers). */
  previewText: string;
  idempotencyKey: string;
  /**
   * Echoed back by the provider in delivery-status webhooks (WhatsApp
   * `biz_opaque_callback_data`), so a send whose response was lost (UNCERTAIN)
   * can still be matched to its notification. Must not contain personal data.
   */
  callbackData?: string;
}

/**
 * Result of a send attempt, classified for safe retry handling:
 * - accepted:  the provider returned a message id (NOT proof of delivery).
 * - rejected:  the provider definitely did not accept the message.
 * - uncertain: the request may have reached the provider (timeout, dropped
 *              connection). Must not be retried automatically.
 */
export type SendOutcome =
  | { kind: "accepted"; providerMessageId: string; httpStatus: number | null }
  | { kind: "rejected"; retryable: boolean; httpStatus: number | null; error: string }
  | { kind: "uncertain"; error: string };

export interface ProviderConnection {
  state: "CONNECTED" | "NOT_CONFIGURED" | "NOT_AUTHORIZED" | "UNAVAILABLE" | "MOCK";
  message: string;
  missing?: string[];
}

export interface WhatsAppProvider {
  readonly id: string;
  readonly isMock: boolean;
  checkConnection(): Promise<ProviderConnection>;
  send(message: OutboundMessage): Promise<SendOutcome>;
}
