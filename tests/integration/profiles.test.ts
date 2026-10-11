import { describe, expect, it } from "vitest";
import { GET as listProfiles, POST as createProfile } from "@/app/api/profiles/route";
import { GET as getProfile, PATCH as patchProfile } from "@/app/api/profiles/[id]/route";
import { POST as archive } from "@/app/api/profiles/[id]/archive/route";
import { POST as restore } from "@/app/api/profiles/[id]/restore/route";
import { POST as duplicate } from "@/app/api/profiles/[id]/duplicate/route";
import { GET as versions } from "@/app/api/profiles/[id]/versions/route";
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
