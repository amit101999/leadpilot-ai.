import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Facts } from "@/components/ui/facts";
import { Panel } from "@/components/ui/panel";
import type { SyncOverview } from "@/modules/imports/schedule";

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  OK: { label: "OK", tone: "success" },
  PARTIAL: { label: "Partial", tone: "warning" },
  ERROR: { label: "Error", tone: "danger" },
};

/** "17 Nov, 16:18 UTC" in the profile's time zone, so it reads like the active hours. */
function at(date: Date, timeZone: string): string {
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${text} ${timeZone}`;
}

export function intervalText(everyHours: number): string {
  return everyHours === 1 ? "Every hour" : `Every ${everyHours} hours`;
}

/** The profile's Upwork sync schedule and how the last sync went. */
export function SyncSchedule({ overview, now = new Date() }: { overview: SyncOverview; now?: Date }) {
  const { timezone } = overview;
  const allDay = overview.activeFrom === "00:00" && overview.activeTo === "23:59";
  const hours = allDay ? "around the clock" : `${overview.activeFrom}–${overview.activeTo}`;
  const status = overview.lastStatus ? STATUS[overview.lastStatus] : undefined;

  let next = "Off";
  if (overview.enabled && !overview.hasKeywords) next = "Never: add search keywords first";
  else if (overview.enabled && overview.nextSyncAt) {
    next =
      overview.nextSyncAt.getTime() <= now.getTime()
        ? "Due now: at the next hourly check of the sync agent"
        : `Around ${at(overview.nextSyncAt, timezone)} (at the sync agent's next hourly check)`;
  }

  return (
    <Panel
      id="sync-schedule"
      title="Upwork sync schedule"
      description="The Claude sync agent checks in every hour; LeadPilot decides when this profile is due. Change the interval in the Search & sync tab."
    >
      {overview.stale && (
        <p role="alert" className="mx-4 mt-4 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
          The Upwork sync agent has not checked in since{" "}
          {overview.lastSyncedAt ? at(overview.lastSyncedAt, timezone) : "the profile was set up"}, although
          this profile is due. The Claude cloud routine may be paused or failing: check it on claude.ai
          (Routines).
        </p>
      )}
      <Facts
        rows={[
          [
            "Schedule",
            overview.enabled ? `${intervalText(overview.everyHours)}, ${hours} (${timezone})` : "Off",
          ],
          [
            "Last sync",
            overview.lastSyncedAt ? (
              <span className="flex flex-wrap items-center gap-2">
                {at(overview.lastSyncedAt, timezone)}
                {status && <Badge tone={status.tone}>{status.label}</Badge>}
              </span>
            ) : (
              "Never synced yet"
            ),
          ],
          ...(overview.lastError ? ([["Last problem", overview.lastError]] as Array<[string, string]>) : []),
          [
            "Jobs scanned up to",
            overview.scannedUpTo
              ? `Posted before ${at(overview.scannedUpTo, timezone)}`
              : "Nothing scanned yet",
          ],
          ["Next sync", next],
        ]}
      />
    </Panel>
  );
}
