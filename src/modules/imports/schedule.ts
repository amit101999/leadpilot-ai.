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

/** Re-scan this much before the previous window's end: Upwork lists a job a few minutes after its posting time. */
export const WINDOW_OVERLAP_MS = 30 * 60_000;
/** One sync never looks further back than this, however long syncs were failing. */
export const MAX_WINDOW_MS = 24 * 3_600_000;

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

/** The earliest moment at or after `from` inside the profile's active hours (5-minute precision). */
function firstActiveMoment(sync: SearchConfig["upworkSync"], from: Date): Date | null {
  for (let t = from.getTime(); t <= from.getTime() + SEARCH_LIMIT_MS; t += STEP_MS) {
    if (withinActiveHours(localClock(new Date(t), sync.timezone), sync.activeFrom, sync.activeTo)) {
      return new Date(t);
    }
  }
  return null;
}

/** When the profile became (or becomes) due after its last sync attempt. */
function dueAfterLastSync(search: SearchConfig, lastSyncedAt: Date): Date | null {
  const sync = search.upworkSync;
  return firstActiveMoment(
    sync,
    new Date(lastSyncedAt.getTime() + sync.everyHours * 3_600_000 - TOLERANCE_MS),
  );
}

/**
 * When the profile is next due for a sync (now, if it is due already); null when its sync is off or it
 * has no keywords. The agent syncs at the first cloud-routine run from then on. Pure.
 */
export function nextSyncAt(search: SearchConfig, lastSyncedAt: Date | null, now: Date): Date | null {
  if (!search.upworkSync.enabled || search.keywords.length === 0) return null;
  const due = lastSyncedAt ? dueAfterLastSync(search, lastSyncedAt) : null;
  return firstActiveMoment(search.upworkSync, due && due > now ? due : now);
}

/**
 * True when the profile has been due for longer than the routine's hourly rhythm explains: the
 * Upwork sync agent (the Claude cloud routine) is probably paused or failing. Pure.
 */
export function syncIsStale(search: SearchConfig, lastSyncedAt: Date | null, now: Date): boolean {
  if (!search.upworkSync.enabled || search.keywords.length === 0 || !lastSyncedAt) return false;
  const due = dueAfterLastSync(search, lastSyncedAt);
  return due !== null && now.getTime() - due.getTime() > STALE_AFTER_MS;
}

export interface SyncOverview {
  enabled: boolean;
  everyHours: number;
  activeFrom: string;
  activeTo: string;
  timezone: string;
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

/** What the UI shows about a profile's sync schedule. Pure. */
export function buildSyncOverview(
  search: SearchConfig,
  state: {
    lastSyncedAt: Date | null;
    lastStatus: string | null;
    lastError: string | null;
    windowEnd: Date | null;
  } | null,
  now: Date,
): SyncOverview {
  const sync = search.upworkSync;
  const lastSyncedAt = state?.lastSyncedAt ?? null;
  return {
    enabled: sync.enabled,
    everyHours: sync.everyHours,
    activeFrom: sync.activeFrom,
    activeTo: sync.activeTo,
    timezone: sync.timezone,
    hasKeywords: search.keywords.length > 0,
    lastSyncedAt,
    lastStatus: state?.lastStatus ?? null,
    lastError: state?.lastError ?? null,
    scannedUpTo: state?.windowEnd ?? null,
    nextSyncAt: nextSyncAt(search, lastSyncedAt, now),
    stale: syncIsStale(search, lastSyncedAt, now),
  };
}

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
