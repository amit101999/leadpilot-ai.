import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { ownerFilter, requireRole, type Actor } from "@/lib/auth/authorization";
import type { Database, DbExecutor } from "@/lib/database/client";
import { notificationRecipients, profileVersions, searchProfiles, users } from "@/lib/database/schema";
import { AppError, notFound } from "@/lib/http/errors";
import { recordAudit, userActor } from "@/modules/audit/service";
import { profileConfigSchema, type ProfileConfig } from "./config-schema";
import type { CreateProfileInput, UpdateProfileInput } from "./schema";

export type ProfileRow = typeof searchProfiles.$inferSelect;
export type ProfileVersionRow = typeof profileVersions.$inferSelect;

function scopedProfile(actor: Actor, id: string) {
  const owner = ownerFilter(actor);
  return owner
    ? and(eq(searchProfiles.id, id), eq(searchProfiles.ownerUserId, owner))
    : eq(searchProfiles.id, id);
}

/** Stored configuration is re-validated on read so a malformed row fails loudly, not silently. */
export function parseStoredConfig(value: unknown): ProfileConfig {
  return profileConfigSchema.parse(value);
}

export async function listProfiles(db: Database, actor: Actor, options: { includeArchived?: boolean } = {}) {
  const owner = ownerFilter(actor);
  const conditions = [
    owner ? eq(searchProfiles.ownerUserId, owner) : undefined,
    options.includeArchived ? undefined : isNull(searchProfiles.archivedAt),
  ].filter(Boolean);
  return db
    .select()
    .from(searchProfiles)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(searchProfiles.isDefault), searchProfiles.name);
}

export async function getProfile(db: DbExecutor, actor: Actor, id: string): Promise<ProfileRow> {
  const [row] = await db.select().from(searchProfiles).where(scopedProfile(actor, id)).limit(1);
  if (!row) throw notFound("Profile");
  return row;
}

async function lockProfile(tx: DbExecutor, actor: Actor, id: string): Promise<ProfileRow> {
  const [row] = await tx.select().from(searchProfiles).where(scopedProfile(actor, id)).for("update").limit(1);
  if (!row) throw notFound("Profile");
  return row;
}

/** A profile may only notify recipients that belong to the profile's owner. */
async function assertRecipientUsable(
  tx: DbExecutor,
  ownerUserId: string,
  config: ProfileConfig,
): Promise<void> {
  const selected = [
    { id: config.notifications.emailRecipientId, channel: "EMAIL" as const, field: "emailRecipientId" },
  ];
  for (const { id, channel, field } of selected) {
    if (!id) continue;
    const [recipient] = await tx
      .select({ id: notificationRecipients.id })
      .from(notificationRecipients)
      .where(
        and(
          eq(notificationRecipients.id, id),
          eq(notificationRecipients.ownerUserId, ownerUserId),
          eq(notificationRecipients.channel, channel),
          isNull(notificationRecipients.archivedAt),
        ),
      )
      .limit(1);
    if (!recipient) {
      throw new AppError("VALIDATION_ERROR", "Selected recipient was not found", [
        { path: `configuration.notifications.${field}`, message: "Recipient not found" },
      ]);
    }
  }
}

export async function createProfile(
  db: Database,
  actor: Actor,
  input: CreateProfileInput,
  requestId?: string,
): Promise<ProfileRow> {
  requireRole(actor, "OPERATOR");
  return db.transaction(async (tx) => {
    await assertRecipientUsable(tx, actor.id, input.configuration);
    const [profile] = await tx
      .insert(searchProfiles)
      .values({
        ownerUserId: actor.id,
        name: input.name,
        description: input.description ?? null,
        configuration: input.configuration,
        currentVersion: 1,
      })
      .returning();
    if (!profile) throw new Error("Profile insert returned no row");
    await tx.insert(profileVersions).values({
      profileId: profile.id,
      versionNumber: 1,
      name: profile.name,
      description: profile.description,
      configuration: input.configuration,
      changeNote: input.changeNote ?? "Created",
      createdBy: actor.id,
    });
    await recordAudit(tx, {
      actor: userActor(actor.id),
      action: "profile.create",
      entityType: "search_profile",
      entityId: profile.id,
      after: { name: profile.name, version: 1, configuration: input.configuration },
      requestId,
    });
    return profile;
  });
}

/**
 * Saves a new immutable version. Runs already in progress are unaffected
 * because they execute against their own configuration snapshot.
 */
export async function updateProfile(
  db: Database,
  actor: Actor,
  id: string,
  input: UpdateProfileInput,
  requestId?: string,
): Promise<ProfileRow> {
  requireRole(actor, "OPERATOR");
  return db.transaction(async (tx) => {
    const current = await lockProfile(tx, actor, id);
    if (current.archivedAt)
      throw new AppError("INVALID_STATE", "Archived profiles cannot be edited; restore it first");
    if (current.currentVersion !== input.expectedVersion) {
      throw new AppError(
        "VERSION_CONFLICT",
        "This profile was changed by someone else. Reload to see the latest version before saving.",
        { currentVersion: current.currentVersion },
      );
    }
    const nextConfig = input.configuration ?? parseStoredConfig(current.configuration);
    await assertRecipientUsable(tx, current.ownerUserId, nextConfig);
    const next = {
      name: input.name ?? current.name,
      description: input.description === undefined ? current.description : input.description,
      configuration: nextConfig,
    };
    const unchanged =
      next.name === current.name &&
      next.description === current.description &&
      JSON.stringify(next.configuration) === JSON.stringify(current.configuration);
    if (unchanged) return current;

    const version = current.currentVersion + 1;
    await tx.insert(profileVersions).values({
      profileId: id,
      versionNumber: version,
      name: next.name,
      description: next.description,
      configuration: next.configuration,
      changeNote: input.changeNote ?? null,
      createdBy: actor.id,
    });
    const [updated] = await tx
      .update(searchProfiles)
      .set({ ...next, currentVersion: version, updatedAt: new Date() })
      .where(and(eq(searchProfiles.id, id), eq(searchProfiles.currentVersion, input.expectedVersion)))
      .returning();
    if (!updated) throw new AppError("VERSION_CONFLICT", "Profile changed concurrently. Reload and retry.");
    await recordAudit(tx, {
      actor: userActor(actor.id),
      action: "profile.update",
      entityType: "search_profile",
      entityId: id,
      before: { name: current.name, version: current.currentVersion, configuration: current.configuration },
      after: { name: next.name, version, configuration: next.configuration },
      requestId,
    });
    return updated;
  });
}

export async function duplicateProfile(
  db: Database,
  actor: Actor,
  id: string,
  name: string | undefined,
  requestId?: string,
): Promise<ProfileRow> {
  requireRole(actor, "OPERATOR");
  const source = await getProfile(db, actor, id);
  const config = parseStoredConfig(source.configuration);
  // The copy belongs to the acting user; drop a recipient that belongs to someone else.
  if (source.ownerUserId !== actor.id) {
    config.notifications.emailRecipientId = null;
    config.notifications.emailEnabled = false;
  }
  return createProfile(
    db,
    actor,
    {
      name: (name ?? `${source.name} (copy)`).slice(0, 120),
      description: source.description,
      configuration: config,
      changeNote: `Duplicated from "${source.name}" v${source.currentVersion}`,
    },
    requestId,
  );
}

export async function setArchived(
  db: Database,
  actor: Actor,
  id: string,
  archived: boolean,
  requestId?: string,
): Promise<ProfileRow> {
  requireRole(actor, "OPERATOR");
  return db.transaction(async (tx) => {
    const current = await lockProfile(tx, actor, id);
    if (Boolean(current.archivedAt) === archived) return current;
    const [updated] = await tx
      .update(searchProfiles)
      .set({
        archivedAt: archived ? new Date() : null,
        active: !archived,
        isDefault: archived ? false : current.isDefault,
        updatedAt: new Date(),
      })
      .where(eq(searchProfiles.id, id))
      .returning();
    await recordAudit(tx, {
      actor: userActor(actor.id),
      action: archived ? "profile.archive" : "profile.restore",
      entityType: "search_profile",
      entityId: id,
      requestId,
    });
    return updated!;
  });
}

export async function setDefault(
  db: Database,
  actor: Actor,
  id: string,
  requestId?: string,
): Promise<ProfileRow> {
  requireRole(actor, "OPERATOR");
  return db.transaction(async (tx) => {
    const current = await lockProfile(tx, actor, id);
    if (current.archivedAt) throw new AppError("INVALID_STATE", "Archived profiles cannot be the default");
    await tx
      .update(searchProfiles)
      .set({ isDefault: false })
      .where(and(eq(searchProfiles.ownerUserId, current.ownerUserId), eq(searchProfiles.isDefault, true)));
    const [updated] = await tx
      .update(searchProfiles)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(searchProfiles.id, id))
      .returning();
    await recordAudit(tx, {
      actor: userActor(actor.id),
      action: "profile.set_default",
      entityType: "search_profile",
      entityId: id,
      requestId,
    });
    return updated!;
  });
}

export async function listVersions(db: Database, actor: Actor, id: string): Promise<ProfileVersionRow[]> {
  await getProfile(db, actor, id);
  return db
    .select()
    .from(profileVersions)
    .where(eq(profileVersions.profileId, id))
    .orderBy(desc(profileVersions.versionNumber));
}

/** Version history with the e-mail of the user who saved each version (newest first). */
export async function listVersionsWithAuthors(db: Database, actor: Actor, id: string) {
  await getProfile(db, actor, id);
  return db
    .select({ version: profileVersions, authorEmail: users.email })
    .from(profileVersions)
    .leftJoin(users, eq(users.id, profileVersions.createdBy))
    .where(eq(profileVersions.profileId, id))
    .orderBy(desc(profileVersions.versionNumber));
}

export async function getCurrentVersion(tx: DbExecutor, profile: ProfileRow): Promise<ProfileVersionRow> {
  const [version] = await tx
    .select()
    .from(profileVersions)
    .where(
      and(
        eq(profileVersions.profileId, profile.id),
        eq(profileVersions.versionNumber, profile.currentVersion),
      ),
    )
    .limit(1);
  if (!version) throw new Error(`Profile ${profile.id} is missing version ${profile.currentVersion}`);
  return version;
}

export async function countActiveProfiles(db: Database, actor: Actor): Promise<number> {
  const owner = ownerFilter(actor);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(searchProfiles)
    .where(and(isNull(searchProfiles.archivedAt), owner ? eq(searchProfiles.ownerUserId, owner) : undefined));
  return row?.count ?? 0;
}
