import type { ProfileConfig } from "@/modules/profiles/config-schema";

export type NotificationChannel = "WHATSAPP" | "EMAIL";

export interface ChannelTarget {
  channel: NotificationChannel;
  recipientId: string;
}

/** The channels a profile alerts on, each with its configured recipient. Pure: safe in any layer. */
export function enabledChannels(config: Pick<ProfileConfig, "notifications">): ChannelTarget[] {
  const n = config.notifications;
  const targets: ChannelTarget[] = [];
  if (n.whatsappEnabled && n.recipientId) targets.push({ channel: "WHATSAPP", recipientId: n.recipientId });
  if (n.emailEnabled && n.emailRecipientId) targets.push({ channel: "EMAIL", recipientId: n.emailRecipientId });
  return targets;
}
