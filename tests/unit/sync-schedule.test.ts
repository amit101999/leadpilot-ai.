import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

import { SyncSchedule } from "@/components/profiles/sync-schedule";
import { SyncSchedulerForm } from "@/components/settings/sync-scheduler";
import { buildSyncOverview, type SyncTarget } from "@/modules/imports/schedule";
import { DEFAULT_SEARCH_CONFIG, defaultProfileConfig } from "@/modules/profiles/config-schema";
import { DEFAULT_SCHEDULE, scheduleSchema, SYNC_INTERVALS, type Schedule } from "@/modules/scheduler/schema";

const target = (sync: Partial<Schedule> = {}, active = true): SyncTarget => ({
  schedule: { ...DEFAULT_SCHEDULE, ...sync },
  active,
  keywords: ["Zoho"],
});
const now = new Date("2026-11-18T12:00:00Z");
const render = (overview: ReturnType<typeof buildSyncOverview>) =>
  renderToStaticMarkup(createElement(SyncSchedule, { overview, now }));

describe("sync scheduler settings", () => {
  const withInterval = (everyHours: number) => ({ ...DEFAULT_SCHEDULE, everyHours });

  it("offers every 1, 2, 3, 4, 6, 8, 12 or 24 hours and nothing else", () => {
    expect([...SYNC_INTERVALS]).toEqual([1, 2, 3, 4, 6, 8, 12, 24]);
    for (const hours of SYNC_INTERVALS)
      expect(scheduleSchema.safeParse(withInterval(hours)).success).toBe(true);
    for (const hours of [0, 5, 0.5, 25])
      expect(scheduleSchema.safeParse(withInterval(hours)).success).toBe(false);
    expect(scheduleSchema.safeParse(withInterval(5)).error?.issues[0]?.message).toBe(
      "Choose every 1, 2, 3, 4, 6, 8, 12 or 24 hours",
    );
  });

  it("checks the active hours and the time zone", () => {
    expect(scheduleSchema.safeParse({ ...DEFAULT_SCHEDULE, activeFrom: "25:00" }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...DEFAULT_SCHEDULE, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...DEFAULT_SCHEDULE, timezone: "Asia/Kolkata" }).success).toBe(true);
  });

  it("defaults to on, every 4 hours, around the clock in UTC", () => {
    expect(DEFAULT_SCHEDULE).toEqual({
      enabled: true,
      everyHours: 4,
      activeFrom: "00:00",
      activeTo: "23:59",
      timezone: "UTC",
    });
  });

  it("never changes the shared profile default when one profile's settings change", () => {
    const config = defaultProfileConfig();
    config.search.upworkSync.everyHours = 1;
    expect(DEFAULT_SEARCH_CONFIG.upworkSync.everyHours).toBe(4);
    expect(defaultProfileConfig().search.upworkSync.everyHours).toBe(4);
  });

  it("renders the scheduler form with every interval, read-only for viewers", () => {
    const editable = renderToStaticMarkup(
      createElement(SyncSchedulerForm, { schedule: { ...DEFAULT_SCHEDULE, everyHours: 2 }, canEdit: true }),
    );
    for (const label of ["Every hour", "Every 2 hours", "Every 3 hours", "Every 24 hours"]) {
      expect(editable).toContain(label);
    }
    expect(editable).toContain("Save scheduler");
    const readOnly = renderToStaticMarkup(
      createElement(SyncSchedulerForm, { schedule: DEFAULT_SCHEDULE, canEdit: false }),
    );
    expect(readOnly).not.toContain("Save scheduler");
    expect(readOnly).toContain("can view the scheduler but not change it");
  });
});

describe("sync schedule panel", () => {
  it("shows the scheduler, the last sync and the next one for the active profile", () => {
    const html = render(
      buildSyncOverview(
        target({ everyHours: 4 }),
        {
          lastSyncedAt: new Date("2026-11-18T10:18:00Z"),
          lastStatus: "OK",
          lastError: null,
          windowEnd: new Date("2026-11-18T10:18:00Z"),
        },
        now,
      ),
    );
    expect(html).toContain("Every 4 hours, around the clock (UTC)");
    expect(html).toContain("Active: synced");
    expect(html).toContain("18 Nov, 10:18 UTC");
    expect(html).toContain(">OK<");
    expect(html).toContain("Posted before 18 Nov, 10:18 UTC");
    expect(html).toContain("Around 18 Nov, 14:13 UTC");
    expect(html).toContain('href="/settings#sync-scheduler"');
    expect(html).not.toContain('role="alert"');
  });

  it("says an inactive profile is never synced", () => {
    const html = render(buildSyncOverview(target({}, false), null, now));
    expect(html).toContain("Inactive: not synced");
    expect(html).toContain("Never: this profile is inactive");
  });

  it("warns when the sync agent stopped checking in, and shows the last problem", () => {
    const html = render(
      buildSyncOverview(
        target({ everyHours: 1 }),
        {
          lastSyncedAt: new Date("2026-11-18T06:18:00Z"),
          lastStatus: "ERROR",
          lastError: "Upwork search failed",
          windowEnd: new Date("2026-11-18T05:18:00Z"),
        },
        now,
      ),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("cloud routine may be paused");
    expect(html).toContain("Upwork search failed");
    expect(html).toContain(">Error<");
    expect(html).toContain("Due now");
  });

  it("says Off when the scheduler is turned off", () => {
    const html = render(buildSyncOverview(target({ enabled: false }), null, now));
    expect(html).toContain("Off: the sync scheduler is turned off");
    expect(html).toContain("Never synced yet");
  });
});
