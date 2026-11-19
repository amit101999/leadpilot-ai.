import { z } from "zod";
import { profileConfigSchema, SYNC_INTERVALS } from "./config-schema";

const name = z.string().trim().min(2, "Name must be at least 2 characters").max(120);
const description = z.string().trim().max(1000).nullable().optional();
const changeNote = z.string().trim().max(500).optional();

/**
 * A configuration being saved. Stricter than reading a stored one: the sync interval must be one of
 * SYNC_INTERVALS, while versions saved earlier with another interval still load.
 */
export const savableConfigSchema = profileConfigSchema.refine(
  (config) => (SYNC_INTERVALS as readonly number[]).includes(config.search.upworkSync.everyHours),
  { path: ["search", "upworkSync", "everyHours"], message: "Choose every 1, 2 or 4 hours" },
);

export const createProfileSchema = z.object({
  name,
  description,
  configuration: savableConfigSchema,
  changeNote,
});
export type CreateProfileInput = z.infer<typeof createProfileSchema>;

export const updateProfileSchema = z
  .object({
    /** Version the client last loaded; mismatch => 409 VERSION_CONFLICT (optimistic locking). */
    expectedVersion: z.number().int().min(1),
    name: name.optional(),
    description,
    configuration: savableConfigSchema.optional(),
    changeNote,
  })
  .refine((v) => v.name !== undefined || v.description !== undefined || v.configuration !== undefined, {
    message: "Nothing to update",
  });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const duplicateProfileSchema = z.object({ name: name.optional() });
