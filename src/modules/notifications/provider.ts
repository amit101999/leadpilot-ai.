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
