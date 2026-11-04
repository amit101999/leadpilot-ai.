import { randomUUID } from "node:crypto";
import type { EmailProvider, OutboundEmail } from "./email-provider";
import type { ProviderConnection, SendOutcome } from "./provider";

export interface MockSentEmail {
  subject: string;
  text: string;
  idempotencyKey: string;
  providerMessageId: string;
}

/** In-memory e-mail provider. Sends nothing; tests can script outcomes with `queueOutcome`. */
export class MockEmailProvider implements EmailProvider {
  readonly id = "mock";
  readonly isMock = true;
  readonly sent: MockSentEmail[] = [];
  private readonly scripted: SendOutcome[] = [];

  queueOutcome(...outcomes: SendOutcome[]): void {
    this.scripted.push(...outcomes);
  }

  reset(): void {
    this.sent.length = 0;
    this.scripted.length = 0;
  }

  async checkConnection(): Promise<ProviderConnection> {
    return { state: "MOCK", message: "Mock e-mail provider: messages are recorded, not sent." };
  }

  async send(message: OutboundEmail): Promise<SendOutcome> {
    const outcome = this.scripted.shift() ?? {
      kind: "accepted" as const,
      providerMessageId: `mock-email-${randomUUID()}`,
      httpStatus: null,
    };
    if (outcome.kind === "accepted") {
      this.sent.push({
        subject: message.subject,
        text: message.text,
        idempotencyKey: message.idempotencyKey,
        providerMessageId: outcome.providerMessageId,
      });
    }
    return outcome;
  }
}
