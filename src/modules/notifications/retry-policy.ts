/**
 * Manual retry rules, shared by the server (enforcement) and the UI (buttons,
 * countdown). No server-only imports: this module is bundled for the browser.
 */

/** An UNCERTAIN send may still arrive; a manual retry must wait this long first. */
export const UNCERTAIN_RETRY_WAIT_MS = 15 * 60_000;

/**
 * A send is never in flight this long (provider timeouts are at most 60 s): a row still SENDING after it was
 * claimed by a process that died (e.g. a restart during a manual retry of a finished run's alert). It may or may
 * not have been sent, so it is handled like UNCERTAIN.
 */
export const STALE_SENDING_MS = 10 * 60_000;

export type RetryMode = "retry" | "confirm-after-wait" | "none";

export function isStaleSending(
  status: string,
  lastAttemptAt: Date | string | null,
  now = Date.now(),
): boolean {
  return (
    status === "SENDING" &&
    lastAttemptAt !== null &&
    now - new Date(lastAttemptAt).getTime() > STALE_SENDING_MS
  );
}

/** Which retry, if any, a notification in this status allows. */
export function retryModeFor(status: string, lastAttemptAt: Date | string | null = null): RetryMode {
  if (status === "FAILED_RETRYABLE" || status === "FAILED_PERMANENT") return "retry";
  if (status === "UNCERTAIN" || isStaleSending(status, lastAttemptAt)) return "confirm-after-wait";
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
