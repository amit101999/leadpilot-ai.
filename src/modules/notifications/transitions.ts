import type { TransitionMap } from "@/lib/state-machine";
import type { NotificationStatus } from "@/types/domain";

/**
 * Notification lifecycle.
 *
 * RESERVED -> SENDING is committed *before* the provider call. If the process
 * dies or the call times out after the request may have reached the provider,
 * the row becomes UNCERTAIN and is never retried automatically: the provider
 * may already have delivered it. Only an explicit, audited operator action
 * moves it on.
 */
export const NOTIFICATION_TRANSITIONS: TransitionMap<NotificationStatus> = {
  RESERVED: ["SENDING", "CANCELLED"],
  SENDING: ["SENT", "FAILED_RETRYABLE", "FAILED_PERMANENT", "UNCERTAIN"],
  FAILED_RETRYABLE: ["SENDING", "FAILED_PERMANENT", "CANCELLED"],
  // An operator confirms whether a message whose send response was lost went out.
  UNCERTAIN: ["SENT", "FAILED_PERMANENT", "SENDING"],
  SENT: ["FAILED_PERMANENT"],
  // A terminal failure releases the claim: a later run may re-reserve the row.
  FAILED_PERMANENT: ["RESERVED"],
  CANCELLED: ["RESERVED"],
};

/** Statuses that count as "this job has been (or may have been) sent to this recipient". */
export const CLAIMED_NOTIFICATION_STATUSES: readonly NotificationStatus[] = [
  "RESERVED",
  "SENDING",
  "SENT",
  "FAILED_RETRYABLE",
  "UNCERTAIN",
];

/** Statuses a later run may re-claim. */
export const RECLAIMABLE_NOTIFICATION_STATUSES: readonly NotificationStatus[] = [
  "FAILED_PERMANENT",
  "CANCELLED",
];
