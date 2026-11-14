/**
 * Manual retry rules, shared by the server (enforcement) and the UI (buttons,
 * countdown). No server-only imports: this module is bundled for the browser.
 */

/** An UNCERTAIN send may still arrive; a manual retry must wait this long first. */
export const UNCERTAIN_RETRY_WAIT_MS = 15 * 60_000;

export type RetryMode = "retry" | "confirm-after-wait" | "none";

/** Which retry, if any, a notification in this status allows. */
export function retryModeFor(status: string): RetryMode {
  if (status === "FAILED_RETRYABLE" || status === "FAILED_PERMANENT") return "retry";
  if (status === "UNCERTAIN") return "confirm-after-wait";
  return "none";
}

/** When an UNCERTAIN notification becomes eligible for a manual retry. */
export function uncertainRetryEligibleAt(
  lastAttemptAt: Date | string | null,
  updatedAt: Date | string,
): Date {
  const since = new Date(lastAttemptAt ?? updatedAt);
  return new Date(since.getTime() + UNCERTAIN_RETRY_WAIT_MS);
}
