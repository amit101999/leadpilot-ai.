import type { ProfileRow } from "@/modules/profiles/service";
import { parseStoredConfig } from "@/modules/profiles/service";
import type { LaunchableProfile } from "./run-launcher";

/**
 * Profiles the run launcher offers (server side): every non-archived profile, the active one first.
 * Inactive profiles are never synced from Upwork but can still be run by hand.
 */
export function toLaunchable(profiles: ProfileRow[]): LaunchableProfile[] {
  return profiles
    .filter((p) => !p.archivedAt)
    .sort((a, b) => Number(b.active) - Number(a.active))
    .map((p) => {
      const config = parseStoredConfig(p.configuration);
      return {
        id: p.id,
        name: p.name,
        active: p.active,
        emailEnabled: config.notifications.emailEnabled,
        maxAlerts: config.notifications.maxPerRun,
      };
    });
}
