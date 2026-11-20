import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/runs/executor", () => ({ dispatchRun: vi.fn(async () => ({ ok: true })) }));

import { POST as activate } from "@/app/api/profiles/[id]/activate/route";
import { GET as listProfiles, POST as createProfile } from "@/app/api/profiles/route";
import { POST as createRun } from "@/app/api/runs/route";
import { GET as getScheduler, PUT as putScheduler } from "@/app/api/sync-schedule/route";
import { GET as getProfile, PATCH as patchProfile } from "@/app/api/profiles/[id]/route";
import { POST as archive } from "@/app/api/profiles/[id]/archive/route";
import { POST as restore } from "@/app/api/profiles/[id]/restore/route";
import { POST as duplicate } from "@/app/api/profiles/[id]/duplicate/route";
import { GET as versions } from "@/app/api/profiles/[id]/versions/route";
import { getDb } from "@/lib/database/client";
import { auditLogs, searchProfiles, syncSchedules, syncState } from "@/lib/database/schema";
import { listSyncOverviews } from "@/modules/imports/service";
import { defaultProfileConfig } from "@/modules/profiles/config-schema";
import { call, createUser, type TestUser } from "./helpers";

async function newProfile(user: TestUser, name = "Web & Zoho Development") {
  const res = await call(createProfile, {
    method: "POST",
    user,
    body: { name, configuration: defaultProfileConfig(null) },
  });
  expect(res.status).toBe(200);
  return res.json.data as { id: string; currentVersion: number };
}

describe("profiles API", () => {
  it("creates a profile at version 1 and saves edits as new versions", async () => {
    const user = await createUser("OPERATOR");
    const profile = await newProfile(user);
    expect(profile.currentVersion).toBe(1);

    const config = defaultProfileConfig(null);
    config.budget.fixedMin = "750.00";
    const updated = await call(patchProfile, {
      method: "PATCH",
      user,
      params: { id: profile.id },
      body: { expectedVersion: 1, configuration: config, changeNote: "Raise minimum budget" },
    });
    expect(updated.status).toBe(200);
    expect(updated.json.data.currentVersion).toBe(2);

    const history = await call(versions, { user, params: { id: profile.id } });
    expect(history.json.data.map((v: { versionNumber: number }) => v.versionNumber).sort()).toEqual([1, 2]);
  });

  it("rejects a stale save with 409 VERSION_CONFLICT (optimistic locking)", async () => {
    const user = await createUser("OPERATOR");
    const profile = await newProfile(user);
    const first = await call(patchProfile, {
      method: "PATCH",
      user,
      params: { id: profile.id },
      body: { expectedVersion: 1, name: "Renamed once" },
    });
    expect(first.status).toBe(200);
    const stale = await call(patchProfile, {
      method: "PATCH",
      user,
      params: { id: profile.id },
      body: { expectedVersion: 1, name: "Renamed from a stale tab" },
    });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe("VERSION_CONFLICT");
  });

  it("validates configuration on the server (weights must sum to 100)", async () => {
    const user = await createUser("OPERATOR");
    const config = defaultProfileConfig(null);
    config.ai.weights.skillAlignment = 50;
    const res = await call(createProfile, {
      method: "POST",
      user,
      body: { name: "Bad", configuration: config },
    });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("VALIDATION_ERROR");
  });

  it("keeps exactly one active profile per user", async () => {
    const user = await createUser("OPERATOR");
    const a = await newProfile(user, "First");
    const b = await newProfile(user, "Second");
    const activeOf = async () =>
      (await getDb().select().from(searchProfiles).where(eq(searchProfiles.ownerUserId, user.id)))
        .filter((p) => p.active)
        .map((p) => p.id);
    // The first profile became active; the second was created inactive.
    expect(await activeOf()).toEqual([a.id]);

    const activated = await call(activate, { method: "POST", user, params: { id: b.id } });
    expect(activated.status).toBe(200);
    expect(await activeOf()).toEqual([b.id]);
    // The database refuses a second active profile even if the service were bypassed.
    await expect(
      getDb().update(searchProfiles).set({ active: true }).where(eq(searchProfiles.id, a.id)),
    ).rejects.toThrow();

    // A duplicate starts inactive; archiving the active profile leaves none; a restore comes back inactive.
    const copy = await call(duplicate, { method: "POST", user, params: { id: b.id }, body: {} });
    expect(copy.json.data.active).toBe(false);
    await call(archive, { method: "POST", user, params: { id: b.id } });
    expect(await activeOf()).toEqual([]);
    expect((await call(activate, { method: "POST", user, params: { id: b.id } })).status).toBe(409);
    const restored = await call(restore, { method: "POST", user, params: { id: b.id } });
    expect(restored.json.data.active).toBe(false);
    // With no active profile, the next new profile becomes active.
    const c = await newProfile(user, "Third");
    expect(await activeOf()).toEqual([c.id]);
  });

  it("lets an inactive profile still be run by hand", async () => {
    const user = await createUser("OPERATOR");
    await newProfile(user, "Active one");
    const inactive = await newProfile(user, "Inactive one");
    const run = await call(createRun, {
      method: "POST",
      user,
      body: { profileId: inactive.id },
      headers: { "idempotency-key": randomUUID() },
    });
    expect(run.status).toBe(201);
  });

  it("saves the sync scheduler for the user (1, 2, 3, 4, 6, 8, 12 or 24 h) and audits it", async () => {
    const user = await createUser("OPERATOR");
    const viewer = await createUser("VIEWER");
    expect((await call(getScheduler, { user })).json.data).toMatchObject({ enabled: true, everyHours: 4 });

    const body = {
      enabled: true,
      everyHours: 3,
      activeFrom: "06:00",
      activeTo: "22:00",
      timezone: "Asia/Kolkata",
    };
    expect((await call(putScheduler, { method: "PUT", user, body })).status).toBe(200);
    expect((await call(getScheduler, { user })).json.data).toEqual(body);
    // Another user still has their own (default) scheduler.
    expect((await call(getScheduler, { user: viewer })).json.data.everyHours).toBe(4);

    const refused = await call(putScheduler, { method: "PUT", user, body: { ...body, everyHours: 5 } });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.json)).toContain("Choose every 1, 2, 3, 4, 6, 8, 12 or 24 hours");
    expect((await call(putScheduler, { method: "PUT", user: viewer, body })).status).toBe(403);
    expect(
      (await call(putScheduler, { method: "PUT", user, body, origin: "https://evil.example" })).status,
    ).toBe(403);

    const [entry] = await getDb()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, user.id), eq(auditLogs.action, "scheduler.update")));
    expect(entry?.afterState).toMatchObject({ everyHours: 3 });
  });

  it("migration 0005 keeps the default profile active and copies its sync settings into the scheduler", async () => {
    const owner = await createUser("OPERATOR");
    const config = (everyHours: number, enabled = true) => {
      const c = defaultProfileConfig(null);
      c.search.upworkSync = { enabled, everyHours, activeFrom: "08:00", activeTo: "22:00", timezone: "UTC" };
      return c;
    };
    // Replay the migration's data steps on a pre-0005 shape: is_default exists, every profile active.
    await getDb().execute(
      sql`alter table search_profiles add column is_default boolean not null default false`,
    );
    await getDb().execute(sql`drop index if exists profiles_one_active_per_owner_uq`);
    try {
      const insert = (name: string, isDefault: boolean, everyHours: number) =>
        getDb()
          .execute(sql`insert into search_profiles (owner_user_id, name, configuration, active, is_default)
          values (${owner.id}, ${name}, ${JSON.stringify(config(everyHours))}::jsonb, true, ${isDefault}) returning id`);
      await insert("Old", false, 2);
      const [kept] = await insert("Default", true, 5);
      const migration = readFileSync("database/migrations/0005_scheduler_and_active_profile.sql", "utf8");
      const dataSteps = migration
        .split("--> statement-breakpoint")
        .filter((s) => /INSERT INTO "sync_schedules"|UPDATE "search_profiles"/.test(s));
      for (const step of dataSteps) await getDb().execute(sql.raw(step));

      const rows = await getDb()
        .select()
        .from(searchProfiles)
        .where(eq(searchProfiles.ownerUserId, owner.id));
      expect(rows.filter((r) => r.active).map((r) => r.id)).toEqual([kept!.id]);
      const [schedule] = await getDb()
        .select()
        .from(syncSchedules)
        .where(eq(syncSchedules.ownerUserId, owner.id));
      // 5 h is not a scheduler step: it is rounded up to 6 h; the hours and time zone are kept.
      expect(schedule).toMatchObject({
        enabled: true,
        everyHours: 6,
        activeFrom: "08:00",
        activeTo: "22:00",
      });
    } finally {
      await getDb().execute(sql`alter table search_profiles drop column if exists is_default`);
      await getDb().execute(sql`update search_profiles set active = false where owner_user_id = ${owner.id}`);
      await getDb().execute(
        sql`create unique index if not exists profiles_one_active_per_owner_uq on search_profiles (owner_user_id) where active = true`,
      );
    }
  });

  it("shows each user the sync schedule of their own profiles only", async () => {
    const owner = await createUser("OPERATOR");
    const other = await createUser("OPERATOR");
    const profile = await newProfile(owner);
    await getDb()
      .insert(syncState)
      .values({ profileId: profile.id, lastSyncedAt: new Date(), lastStatus: "OK", windowEnd: new Date() });
    const mine = await listSyncOverviews(getDb(), owner, [profile.id]);
    expect(mine.get(profile.id)).toMatchObject({ lastStatus: "OK", everyHours: 4, stale: false });
    expect(mine.get(profile.id)?.scannedUpTo).toBeInstanceOf(Date);
    const theirs = await listSyncOverviews(getDb(), other, [profile.id]);
    expect(theirs.size).toBe(0);
  });

  it("forbids VIEWERs from creating profiles", async () => {
    const viewer = await createUser("VIEWER");
    const res = await call(createProfile, {
      method: "POST",
      user: viewer,
      body: { name: "Nope", configuration: defaultProfileConfig(null) },
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 for another user's profile and hides it from their list (acceptance #17)", async () => {
    const owner = await createUser("OPERATOR");
    const other = await createUser("OPERATOR");
    const profile = await newProfile(owner, "Owner only");

    expect((await call(getProfile, { user: other, params: { id: profile.id } })).status).toBe(404);
    const edit = await call(patchProfile, {
      method: "PATCH",
      user: other,
      params: { id: profile.id },
      body: { expectedVersion: 1, name: "Hijacked" },
    });
    expect(edit.status).toBe(404);
    const list = await call(listProfiles, { user: other });
    expect(list.json.data.some((p: { id: string }) => p.id === profile.id)).toBe(false);
  });

  it("rejects a state change without a same-origin Origin header (CSRF)", async () => {
    const user = await createUser("OPERATOR");
    const profile = await newProfile(user);
    const res = await call(patchProfile, {
      method: "PATCH",
      user,
      origin: "https://evil.example.com",
      params: { id: profile.id },
      body: { expectedVersion: 1, name: "Cross-site" },
    });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("CSRF_REJECTED");
  });

  it("rejects a malformed id with 400", async () => {
    const user = await createUser("OPERATOR");
    const res = await call(getProfile, { user, params: { id: "not-a-uuid" } });
    expect(res.status).toBe(400);
  });

  it("archives, blocks edits while archived, and restores", async () => {
    const user = await createUser("OPERATOR");
    const profile = await newProfile(user);
    const archived = await call(archive, { method: "POST", user, params: { id: profile.id } });
    expect(archived.json.data.archivedAt).not.toBeNull();

    const edit = await call(patchProfile, {
      method: "PATCH",
      user,
      params: { id: profile.id },
      body: { expectedVersion: 1, name: "Edit archived" },
    });
    expect(edit.status).toBe(409);
    expect(edit.json.error.code).toBe("INVALID_STATE");

    const restored = await call(restore, { method: "POST", user, params: { id: profile.id } });
    expect(restored.json.data.archivedAt).toBeNull();
  });

  it("duplicates a profile as a new version-1 profile", async () => {
    const user = await createUser("OPERATOR");
    const profile = await newProfile(user, "Original");
    const copy = await call(duplicate, { method: "POST", user, params: { id: profile.id }, body: {} });
    expect(copy.status).toBe(200);
    expect(copy.json.data.id).not.toBe(profile.id);
    expect(copy.json.data.name).toBe("Original (copy)");
    expect(copy.json.data.currentVersion).toBe(1);
  });
});
