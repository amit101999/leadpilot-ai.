import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as changePassword } from "@/app/api/auth/password/route";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { resetEnvCache } from "@/lib/configuration/env";
import { getDb } from "@/lib/database/client";
import { rateLimits, users } from "@/lib/database/schema";
import { call } from "./helpers";

// Test values only; the real ones live in the server settings.
const USERNAME = "test.admin";
const PASSWORD = "Short#88";
const ROW_EMAIL = `${USERNAME}@env-admin.invalid`;

function signIn(email: string, password: string) {
  return call(login, { method: "POST", body: { email, password } });
}

function cookieFrom(headers: Headers): string {
  const match = (headers.get("set-cookie") ?? "").match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
  return `${SESSION_COOKIE}=${match![1]}`;
}

function setAdmin(username?: string, password?: string) {
  if (username) process.env.ADMIN_USERNAME = username;
  else delete process.env.ADMIN_USERNAME;
  if (password) process.env.ADMIN_PASSWORD = password;
  else delete process.env.ADMIN_PASSWORD;
  resetEnvCache();
}

describe("admin login from the server settings", () => {
  beforeEach(async () => {
    setAdmin(USERNAME, PASSWORD);
    // Every test signs in as the same name: start each with fresh rate limits and no admin row.
    await getDb().delete(rateLimits);
    await getDb().delete(users).where(eq(users.email, ROW_EMAIL));
  });
  afterEach(() => setAdmin());

  it("signs in with the username, creating one ADMIN row on first login and reusing it", async () => {
    const first = await signIn("Test.Admin", PASSWORD);
    expect(first.status).toBe(200);
    expect(first.json.data.user).toMatchObject({ email: ROW_EMAIL, role: "ADMIN" });

    const second = await signIn(USERNAME, PASSWORD);
    expect(second.status).toBe(200);
    expect(second.json.data.user.id).toBe(first.json.data.user.id);
    const rows = await getDb().select({ id: users.id }).from(users).where(eq(users.email, ROW_EMAIL));
    expect(rows).toHaveLength(1);
  });

  it("rejects a wrong password with the generic 401", async () => {
    const res = await signIn(USERNAME, PASSWORD.toLowerCase());
    expect(res.status).toBe(401);
    expect(res.json.error.message).toBe("Invalid email or password");
  });

  it("does not accept the row's internal e-mail address as a sign-in name", async () => {
    await signIn(USERNAME, PASSWORD);
    expect((await signIn(ROW_EMAIL, PASSWORD)).status).toBe(401);
  });

  it("follows a changed password and stops working when the settings are removed", async () => {
    await signIn(USERNAME, PASSWORD);

    setAdmin(USERNAME, "a-new-password");
    expect((await signIn(USERNAME, PASSWORD)).status).toBe(401);
    expect((await signIn(USERNAME, "a-new-password")).status).toBe(200);

    setAdmin();
    expect((await signIn(USERNAME, "a-new-password")).status).toBe(401);
  });

  it("refuses a disabled row", async () => {
    await signIn(USERNAME, PASSWORD);
    await getDb().update(users).set({ status: "DISABLED" }).where(eq(users.email, ROW_EMAIL));
    expect((await signIn(USERNAME, PASSWORD)).status).toBe(401);
  });

  it("does not let the password be changed in the app", async () => {
    const signedIn = await signIn(USERNAME, PASSWORD);
    const res = await call(changePassword, {
      method: "POST",
      user: { ...signedIn.json.data.user, cookie: cookieFrom(signedIn.headers) },
      body: { currentPassword: PASSWORD, newPassword: "another-long-password" },
    });
    expect(res.status).toBe(400);
    expect(res.json.error.message).toMatch(/ADMIN_PASSWORD/);
  });
});
