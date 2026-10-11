import { randomUUID } from "node:crypto";
import type { OutboundMessage, ProviderConnection, SendOutcome, WhatsAppProvider } from "./provider";

export interface MockSentMessage {
  kind: OutboundMessage["kind"];
  idempotencyKey: string;
  providerMessageId: string;
  previewText: string;
}

/**
 * In-memory WhatsApp provider. Sends nothing. Tests can script outcomes with
 * `queueOutcome`; otherwise every message is accepted.
 */
export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly id = "mock";
  readonly isMock = true;
  readonly sent: MockSentMessage[] = [];
  private readonly scripted: SendOutcome[] = [];

  queueOutcome(...outcomes: SendOutcome[]): void {
    this.scripted.push(...outcomes);
  }

  reset(): void {
    this.sent.length = 0;
    this.scripted.length = 0;
  }

  async checkConnection(): Promise<ProviderConnection> {
    return { state: "MOCK", message: "Mock WhatsApp provider: messages are recorded, not sent." };
  }

  async send(message: OutboundMessage): Promise<SendOutcome> {
    const outcome = this.scripted.shift() ?? {
      kind: "accepted" as const,
      providerMessageId: `mock-wamid-${randomUUID()}`,
      httpStatus: 200,
    };
    if (outcome.kind === "accepted") {
      this.sent.push({
        kind: message.kind,
        idempotencyKey: message.idempotencyKey,
        providerMessageId: outcome.providerMessageId,
        previewText: message.previewText,
      });
    }
    return outcome;
  }
}
