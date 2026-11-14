import type { ProfileConfig } from "@/modules/profiles/config-schema";

/**
 * Channels stored in the database. "WHATSAPP" remains only so records from before
 * WhatsApp alerts were removed still load; new alerts are e-mail only.
 */
export type NotificationChannel = "WHATSAPP" | "EMAIL";

export interface ChannelTarget {
  channel: "EMAIL";
  recipientId: string;
}

/** The channels a profile alerts on, each with its configured recipient. Pure: safe in any layer. */
export function enabledChannels(config: Pick<ProfileConfig, "notifications">): ChannelTarget[] {
  const n = config.notifications;
  return n.emailEnabled && n.emailRecipientId ? [{ channel: "EMAIL", recipientId: n.emailRecipientId }] : [];
}
