import type { RecipientView } from "@/modules/notifications/recipients";
import type { RecipientOption } from "./profile-editor";

/** Only active recipients with confirmed opt-in may be chosen for alerts. */
export function toRecipientOptions(recipients: RecipientView[]): RecipientOption[] {
  return recipients
    .filter((r) => r.optInConfirmedAt && !r.archivedAt)
    .map((r) => ({ id: r.id, label: r.label, address: r.emailMasked ?? "" }));
}

/**
 * The recipient saved on a profile may since have been archived or lost its opt-in, so it is not among the options.
 * The editor then starts from "No recipient" (and says why), so a save asks for another recipient or alerts off
 * instead of sending an id the server rejects.
 */
export function withAvailableRecipient<C extends { notifications: { emailRecipientId: string | null } }>(
  configuration: C | undefined,
  options: RecipientOption[],
): { configuration: C | undefined; recipientUnavailable: boolean } {
  const saved = configuration?.notifications.emailRecipientId ?? null;
  if (!configuration || saved === null || options.some((o) => o.id === saved)) {
    return { configuration, recipientUnavailable: false };
  }
  return {
    configuration: {
      ...configuration,
      notifications: { ...configuration.notifications, emailRecipientId: null },
    },
    recipientUnavailable: true,
  };
}
