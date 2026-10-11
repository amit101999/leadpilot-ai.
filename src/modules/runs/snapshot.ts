import { z } from "zod";
import { PROMPT_VERSION } from "@/modules/ai/prompts/v1";
import { profileConfigSchema, type ProfileConfig } from "@/modules/profiles/config-schema";
import type { ProfileRow, ProfileVersionRow } from "@/modules/profiles/service";
import type { Providers } from "@/modules/providers";
import { RUBRIC_VERSION } from "@/modules/qualification/scoring";

/**
 * Everything a run needs to reproduce its decisions, frozen at creation time.
 * Stored in agent_runs.configuration_snapshot (immutable via DB trigger).
 */
export const runSnapshotSchema = z.object({
  snapshotVersion: z.literal(1),
  profile: z.object({
    id: z.uuid(),
    name: z.string(),
    versionId: z.uuid(),
    versionNumber: z.number().int(),
    ownerUserId: z.uuid(),
  }),
  configuration: profileConfigSchema,
  providers: z.object({
    jobSource: z.string(),
    jobSourceIsMock: z.boolean(),
    ai: z.string(),
    aiModel: z.string(),
    aiIsMock: z.boolean(),
    whatsapp: z.string(),
    whatsappIsMock: z.boolean(),
  }),
  promptVersion: z.string(),
  rubricVersion: z.string(),
  executor: z.enum(["n8n", "inprocess"]),
  createdAt: z.string(),
});
export type RunSnapshot = z.infer<typeof runSnapshotSchema>;

export function buildSnapshot(
  profile: ProfileRow,
  version: ProfileVersionRow,
  providers: Providers,
  executor: RunSnapshot["executor"],
): RunSnapshot {
  return {
    snapshotVersion: 1,
    profile: {
      id: profile.id,
      name: version.name,
      versionId: version.id,
      versionNumber: version.versionNumber,
      ownerUserId: profile.ownerUserId,
    },
    configuration: profileConfigSchema.parse(version.configuration) as ProfileConfig,
    providers: {
      jobSource: providers.jobSource.id,
      jobSourceIsMock: providers.jobSource.getCapabilities().isMock,
      ai: providers.ai.id,
      aiModel: providers.ai.model,
      aiIsMock: providers.ai.isMock,
      whatsapp: providers.whatsapp.id,
      whatsappIsMock: providers.whatsapp.isMock,
    },
    promptVersion: PROMPT_VERSION,
    rubricVersion: RUBRIC_VERSION,
    executor,
    createdAt: new Date().toISOString(),
  };
}

export function parseSnapshot(value: unknown): RunSnapshot {
  return runSnapshotSchema.parse(value);
}
