import type { Schedule } from "@/modules/scheduler/schema";

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

/** Re-scan this much before the previous window's end: Upwork lists a job a few minutes after its posting time. */
export const WINDOW_OVERLAP_MS = 30 * 60_000;
/**
 * One sync never looks further back than this, however long syncs were failing. Longer than the longest
 * interval (24 h) plus the overlap and a missed hourly wake-up, so a daily sync keeps its overlap.
 */
export const MAX_WINDOW_MS = 26 * 3_600_000;

export interface ScanWindow {
  from: Date;
  to: Date;
}

/**
 * The posting-time window the next sync scans: from the end of the last successful scan (minus a
 * small overlap; jobs seen before are skipped anyway) up to now. A profile that never synced scans
 * its interval. Pure, for unit tests.
 */
export function scanWindow(windowEnd: Date | null, everyHours: number, now: Date): ScanWindow {
  const start = windowEnd ? windowEnd.getTime() - WINDOW_OVERLAP_MS : now.getTime() - everyHours * 3_600_000;
  const earliest = now.getTime() - MAX_WINDOW_MS;
  return { from: new Date(Math.min(Math.max(start, earliest), now.getTime())), to: now };
}

const STEP_MS = 5 * 60_000;
const SEARCH_LIMIT_MS = 48 * 3_600_000;
/** The cloud routine wakes hourly; a profile due for longer than this means the routine is not checking in. */
export const STALE_AFTER_MS = 75 * 60_000;

/** What decides whether a profile is synced: the owner's scheduler and the profile itself. */
export interface SyncTarget {
  schedule: Schedule;
  /** Only the owner's active profile is ever synced. */
  active: boolean;
  keywords: string[];
}

/** The earliest moment at or after `from` inside the scheduler's active hours (5-minute precision). */
function firstActiveMoment(schedule: Schedule, from: Date): Date | null {
  for (let t = from.getTime(); t <= from.getTime() + SEARCH_LIMIT_MS; t += STEP_MS) {
    if (
      withinActiveHours(localClock(new Date(t), schedule.timezone), schedule.activeFrom, schedule.activeTo)
    ) {
      return new Date(t);
    }
  }
  return null;
}

/** When the profile became (or becomes) due after its last sync attempt. */
function dueAfterLastSync(schedule: Schedule, lastSyncedAt: Date): Date | null {
  return firstActiveMoment(
    schedule,
    new Date(lastSyncedAt.getTime() + schedule.everyHours * 3_600_000 - TOLERANCE_MS),
  );
}

const syncable = (t: SyncTarget) => t.active && t.schedule.enabled && t.keywords.length > 0;

/**
 * When the profile is next due for a sync (now, if it is due already); null when it is not synced at all
 * (inactive, scheduler off, or no keywords). The agent syncs at the first hourly check from then on. Pure.
 */
export function nextSyncAt(target: SyncTarget, lastSyncedAt: Date | null, now: Date): Date | null {
  if (!syncable(target)) return null;
  const due = lastSyncedAt ? dueAfterLastSync(target.schedule, lastSyncedAt) : null;
  return firstActiveMoment(target.schedule, due && due > now ? due : now);
}

/**
 * True when the profile has been due for longer than the routine's hourly rhythm explains: the Upwork
 * sync agent (the Claude cloud routine) is probably paused or failing. Pure.
 */
export function syncIsStale(target: SyncTarget, lastSyncedAt: Date | null, now: Date): boolean {
  if (!syncable(target) || !lastSyncedAt) return false;
  const due = dueAfterLastSync(target.schedule, lastSyncedAt);
  return due !== null && now.getTime() - due.getTime() > STALE_AFTER_MS;
}

export interface SyncOverview extends Schedule {
  active: boolean;
  hasKeywords: boolean;
  lastSyncedAt: Date | null;
  lastStatus: string | null;
  /** Already sanitized when it was stored. */
  lastError: string | null;
  /** End of the last successfully scanned window. */
  scannedUpTo: Date | null;
  nextSyncAt: Date | null;
  stale: boolean;
}

/** What the UI shows about a profile's sync. Pure. */
export function buildSyncOverview(
  target: SyncTarget,
  state: {
    lastSyncedAt: Date | null;
    lastStatus: string | null;
    lastError: string | null;
    windowEnd: Date | null;
  } | null,
  now: Date,
): SyncOverview {
  const lastSyncedAt = state?.lastSyncedAt ?? null;
  return {
    ...target.schedule,
    active: target.active,
    hasKeywords: target.keywords.length > 0,
    lastSyncedAt,
    lastStatus: state?.lastStatus ?? null,
    lastError: state?.lastError ?? null,
    scannedUpTo: state?.windowEnd ?? null,
    nextSyncAt: nextSyncAt(target, lastSyncedAt, now),
    stale: syncIsStale(target, lastSyncedAt, now),
  };
}

/** Whether the import agent should sync this profile now. Pure, for unit tests. */
export function syncDue(target: SyncTarget, lastSyncedAt: Date | null, now: Date): DueDecision {
  const { schedule } = target;
  if (!target.active) return { due: false, reason: "Not the active profile" };
  if (!schedule.enabled) return { due: false, reason: "The sync scheduler is off" };
  if (target.keywords.length === 0) return { due: false, reason: "No search keywords" };
  const clock = localClock(now, schedule.timezone);
  if (!withinActiveHours(clock, schedule.activeFrom, schedule.activeTo)) {
    return {
      due: false,
      reason: `Outside active hours (${schedule.activeFrom}–${schedule.activeTo} ${schedule.timezone})`,
    };
  }
  if (
    lastSyncedAt &&
    now.getTime() - lastSyncedAt.getTime() < schedule.everyHours * 3_600_000 - TOLERANCE_MS
  ) {
    return { due: false, reason: `Synced less than ${schedule.everyHours} h ago` };
  }
  return { due: true };
}
