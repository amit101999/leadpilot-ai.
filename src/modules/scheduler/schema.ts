import { z } from "zod";
import { clockTime, timeZone } from "@/modules/profiles/config-schema";

/**
 * Intervals the Upwork sync scheduler can run at. The Claude cloud routine wakes every hour, so an hour
 * is the shortest. Mirrored by the sync_schedules_every_hours_chk constraint.
 */
export const SYNC_INTERVALS = [1, 2, 3, 4, 6, 8, 12, 24] as const;

/** When the agent syncs a user's active profile. Not part of any profile, so switching profiles keeps it. */
export const scheduleSchema = z.object({
  enabled: z.boolean(),
  everyHours: z
    .number()
    .int()
    .refine((h) => (SYNC_INTERVALS as readonly number[]).includes(h), {
      message: "Choose every 1, 2, 3, 4, 6, 8, 12 or 24 hours",
    }),
  activeFrom: clockTime,
  activeTo: clockTime,
  timezone: timeZone,
});
export type Schedule = z.infer<typeof scheduleSchema>;

/** Used when a user has not saved a scheduler yet. */
export const DEFAULT_SCHEDULE: Schedule = {
  enabled: true,
  everyHours: 4,
  activeFrom: "00:00",
  activeTo: "23:59",
  timezone: "UTC",
};
