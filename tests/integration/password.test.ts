import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as changePassword } from "@/app/api/auth/password/route";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getDb } from "@/lib/database/client";
import { auditLogs } from "@/lib/database/schema";
import { call, createUser, TEST_PASSWORD } from "./helpers";

const NEW_PASSWORD = "a-completely-new-passphrase";

describe("change password API", () => {
  it("rejects a wrong current password with a field error", async () => {
    const user = await createUser("VIEWER");
    const res = await call(changePassword, {
      method: "POST",
      user,
      body: { currentPassword: "not-my-password", newPassword: NEW_PASSWORD },
    });
    expect(res.status).toBe(400);
    expect(res.json.error.details).toEqual([
      { path: "currentPassword", message: "The current password is not correct" },
    ]);
  });

  it("rejects a short or unchanged new password", async () => {
    const user = await createUser("VIEWER");
    const short = await call(changePassword, {
      method: "POST",
      user,
      body: { currentPassword: TEST_PASSWORD, newPassword: "short" },
    });
    expect(short.status).toBe(400);
    const same = await call(changePassword, {
      method: "POST",
      user,
      body: { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD },
    });
    expect(same.status).toBe(400);
  });

  it("changes the password, ends the user's other sessions and keeps the current one", async () => {
    const user = await createUser("OPERATOR");
    const other = await createSession(getDb(), user.id, {});
    const otherUser = { ...user, cookie: `${SESSION_COOKIE}=${other.token}` };
    expect((await call(me, { user: otherUser })).status).toBe(200);

    const res = await call(changePassword, {
      method: "POST",
      user,
      body: { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD },
    });
    expect(res.status).toBe(200);
    expect(res.json.data).toEqual({ otherSessionsEnded: 1 });

    expect((await call(me, { user })).status).toBe(200);
    expect((await call(me, { user: otherUser })).status).toBe(401);

    const oldLogin = await call(login, {
      method: "POST",
      body: { email: user.email, password: TEST_PASSWORD },
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await call(login, {
      method: "POST",
      body: { email: user.email, password: NEW_PASSWORD },
    });
    expect(newLogin.status).toBe(200);

    const audit = await getDb().select().from(auditLogs).where(eq(auditLogs.entityId, user.id));
    const entry = audit.find((a) => a.action === "auth.password_change");
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).not.toContain(NEW_PASSWORD);
  });

  it("rate limits repeated attempts (5 per 15 minutes)", async () => {
    const user = await createUser("VIEWER");
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await call(changePassword, {
        method: "POST",
        user,
        body: { currentPassword: "wrong-guess-number", newPassword: NEW_PASSWORD },
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 400)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it("requires the request to come from the app (CSRF)", async () => {
    const user = await createUser("VIEWER");
    const res = await call(changePassword, {
      method: "POST",
      user,
      origin: "https://evil.example.com",
      body: { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD },
    });
    expect(res.status).toBe(403);
  });
});
