import { z } from "zod";
import { profileConfigSchema } from "./config-schema";

const name = z.string().trim().min(2, "Name must be at least 2 characters").max(120);
const description = z.string().trim().max(1000).nullable().optional();
const changeNote = z.string().trim().max(500).optional();

export const createProfileSchema = z.object({
  name,
  description,
  configuration: profileConfigSchema,
  changeNote,
});
export type CreateProfileInput = z.infer<typeof createProfileSchema>;

export const updateProfileSchema = z
  .object({
    /** Version the client last loaded; mismatch => 409 VERSION_CONFLICT (optimistic locking). */
    expectedVersion: z.number().int().min(1),
    name: name.optional(),
    description,
    configuration: profileConfigSchema.optional(),
    changeNote,
  })
  .refine((v) => v.name !== undefined || v.description !== undefined || v.configuration !== undefined, {
    message: "Nothing to update",
  });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const duplicateProfileSchema = z.object({ name: name.optional() });
