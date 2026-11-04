import type { SearchConfig } from "@/modules/profiles/config-schema";

/** The hourly scheduler fires a little early or late; this much slack keeps "every 3 h" on the hour. */
const TOLERANCE_MS = 5 * 60_000;

/** "HH:MM" of `now` in the profile's time zone. */
export function localClock(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

/** Inclusive window; a window like 22:00–06:00 wraps past midnight. */
export function withinActiveHours(clock: string, from: string, to: string): boolean {
  return from <= to ? clock >= from && clock <= to : clock >= from || clock <= to;
}

export type DueDecision = { due: true } | { due: false; reason: string };

/** Whether the import agent should sync this profile now. Pure, for unit tests. */
export function syncDue(search: SearchConfig, lastSyncedAt: Date | null, now: Date): DueDecision {
  const sync = search.upworkSync;
  if (!sync.enabled) return { due: false, reason: "Upwork sync is off for this profile" };
  if (search.keywords.length === 0) return { due: false, reason: "No search keywords" };
  const clock = localClock(now, sync.timezone);
  if (!withinActiveHours(clock, sync.activeFrom, sync.activeTo)) {
    return {
      due: false,
      reason: `Outside active hours (${sync.activeFrom}–${sync.activeTo} ${sync.timezone})`,
    };
  }
  if (lastSyncedAt && now.getTime() - lastSyncedAt.getTime() < sync.everyHours * 3_600_000 - TOLERANCE_MS) {
    return { due: false, reason: `Synced less than ${sync.everyHours} h ago` };
  }
  return { due: true };
}
