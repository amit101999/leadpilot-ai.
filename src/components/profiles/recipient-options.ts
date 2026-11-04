import type { RecipientView } from "@/modules/notifications/recipients";
import type { RecipientOption } from "./profile-editor";

/** Only active recipients with confirmed opt-in may be chosen for alerts. */
export function toRecipientOptions(recipients: RecipientView[]): RecipientOption[] {
  return recipients
    .filter((r) => r.optInConfirmedAt && !r.archivedAt)
    .map((r) => ({
      id: r.id,
      label: r.label,
      channel: r.channel,
      address: r.phoneMasked ?? r.emailMasked ?? "",
    }));
}
