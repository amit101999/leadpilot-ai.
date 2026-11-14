import type { ProfileRow } from "@/modules/profiles/service";
import { parseStoredConfig } from "@/modules/profiles/service";
import type { LaunchableProfile } from "./run-launcher";

/** Active profiles as options for the run launcher (server side). */
export function toLaunchable(profiles: ProfileRow[]): LaunchableProfile[] {
  return profiles
    .filter((p) => p.active && !p.archivedAt)
    .map((p) => {
      const config = parseStoredConfig(p.configuration);
      return {
        id: p.id,
        name: p.name,
        isDefault: p.isDefault,
        emailEnabled: config.notifications.emailEnabled,
        maxAlerts: config.notifications.maxPerRun,
      };
    });
}
