import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SyncSchedule } from "@/components/profiles/sync-schedule";
import { buildSyncOverview } from "@/modules/imports/schedule";
import {
  DEFAULT_SEARCH_CONFIG,
  defaultProfileConfig,
  type SearchConfig,
} from "@/modules/profiles/config-schema";
import { savableConfigSchema } from "@/modules/profiles/schema";
import { parseStoredConfig } from "@/modules/profiles/service";

const search = (sync: Partial<SearchConfig["upworkSync"]> = {}): SearchConfig => ({
  ...DEFAULT_SEARCH_CONFIG,
  keywords: ["Zoho"],
  upworkSync: { ...DEFAULT_SEARCH_CONFIG.upworkSync, enabled: true, ...sync },
});
const now = new Date("2026-11-18T12:00:00Z");
const render = (overview: ReturnType<typeof buildSyncOverview>) =>
  renderToStaticMarkup(createElement(SyncSchedule, { overview, now }));

describe("sync interval choices", () => {
  const withInterval = (everyHours: number) => {
    const config = defaultProfileConfig();
    config.search.upworkSync.everyHours = everyHours;
    return config;
  };

  it("saves every 1, 2 or 4 hours and nothing else", () => {
    for (const hours of [1, 2, 4])
      expect(savableConfigSchema.safeParse(withInterval(hours)).success).toBe(true);
    for (const hours of [0, 3, 0.5, 6]) {
      const result = savableConfigSchema.safeParse(withInterval(hours));
      expect(result.success).toBe(false);
    }
    const refused = savableConfigSchema.safeParse(withInterval(3));
    expect(refused.error?.issues.map((i) => i.message)).toContain("Choose every 1, 2 or 4 hours");
  });

  it("still loads versions saved earlier with another interval", () => {
    expect(parseStoredConfig(withInterval(3)).search.upworkSync.everyHours).toBe(3);
  });

  it("never changes the shared default when one profile's schedule changes", () => {
    const config = defaultProfileConfig();
    config.search.upworkSync.everyHours = 1;
    expect(DEFAULT_SEARCH_CONFIG.upworkSync.everyHours).toBe(4);
    expect(defaultProfileConfig().search.upworkSync.everyHours).toBe(4);
  });

  it("defaults to every 4 hours, around the clock", () => {
    expect(DEFAULT_SEARCH_CONFIG.upworkSync).toMatchObject({
      everyHours: 4,
      activeFrom: "00:00",
      activeTo: "23:59",
    });
  });
});

describe("sync schedule panel", () => {
  it("shows the schedule, the last sync and the next one", () => {
    const html = render(
      buildSyncOverview(
        search({ everyHours: 4 }),
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
    expect(html).toContain("18 Nov, 10:18 UTC");
    expect(html).toContain(">OK<");
    expect(html).toContain("Posted before 18 Nov, 10:18 UTC");
    expect(html).toContain("Around 18 Nov, 14:13 UTC");
    expect(html).not.toContain('role="alert"');
  });

  it("warns when the sync agent stopped checking in, and shows the last problem", () => {
    const html = render(
      buildSyncOverview(
        search({ everyHours: 1 }),
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

  it("says Off when the profile does not sync", () => {
    const html = render(buildSyncOverview(search({ enabled: false }), null, now));
    expect(html).toContain("Off");
    expect(html).toContain("Never synced yet");
  });
});
