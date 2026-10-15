import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/runs/executor", () => ({ dispatchRun: vi.fn(async () => ({ ok: true })) }));

import { POST as createProfile } from "@/app/api/profiles/route";
import { POST as createRun } from "@/app/api/runs/route";
import { getDb } from "@/lib/database/client";
import { agentRuns, profileVersions } from "@/lib/database/schema";
import { defaultProfileConfig } from "@/modules/profiles/config-schema";
import { call, createUser } from "./helpers";

/**
 * The application never edits history, but these guarantees are enforced by the
 * database itself (database/migrations/0001_immutability_guards.sql), so a bug or a
 * manual query cannot rewrite them either.
 */
async function profileWithRun() {
  const user = await createUser("OPERATOR");
  const profile = await call(createProfile, {
    method: "POST",
    user,
    body: { name: `Profile ${randomUUID().slice(0, 6)}`, configuration: defaultProfileConfig(null) },
  });
  const run = await call(createRun, {
    method: "POST",
    user,
    body: { profileId: profile.json.data.id },
    headers: { "idempotency-key": randomUUID() },
  });
  return { profileId: profile.json.data.id as string, runId: run.json.data.id as string };
}

/** Drizzle wraps driver errors; the Postgres message is on the error or its cause. */
async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e as Error & { cause?: Error },
  );
  expect(error).not.toBeNull();
  return `${error!.message} ${error!.cause?.message ?? ""}`;
}

describe("database immutability guards", () => {
  it("refuses to update or delete a saved profile version", async () => {
    const { profileId } = await profileWithRun();
    const where = eq(profileVersions.profileId, profileId);

    expect(
      await rejection(getDb().update(profileVersions).set({ changeNote: "rewritten" }).where(where)),
    ).toContain("profile_versions rows are immutable");
    expect(await rejection(getDb().delete(profileVersions).where(where))).toContain(
      "profile_versions rows are immutable",
    );
  });

  it("refuses to change a run's configuration snapshot but allows status updates", async () => {
    const { runId } = await profileWithRun();
    const where = eq(agentRuns.id, runId);

    expect(
      await rejection(
        getDb()
          .update(agentRuns)
          .set({ configurationSnapshot: { tampered: true } })
          .where(where),
      ),
    ).toContain("configuration snapshot is immutable");

    await getDb().update(agentRuns).set({ status: "CANCELLED", finishedAt: new Date() }).where(where);
    const [run] = await getDb().select().from(agentRuns).where(where);
    expect(run!.status).toBe("CANCELLED");
  });
});
