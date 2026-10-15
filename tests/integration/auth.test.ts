import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";
import { GET as health } from "@/app/api/health/route";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { getDb } from "@/lib/database/client";
import { sessions } from "@/lib/database/schema";
import { call, createUser, TEST_PASSWORD } from "./helpers";

function sessionCookieFrom(headers: Headers): string | null {
  const raw = headers.get("set-cookie") ?? "";
  const match = raw.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
  return match ? `${SESSION_COOKIE}=${match[1]}` : null;
}

describe("auth API", () => {
  it("logs in with valid credentials and sets an HttpOnly, SameSite=Lax session cookie", async () => {
    const user = await createUser("OPERATOR");
    const res = await call(login, {
      method: "POST",
      body: { email: user.email.toUpperCase(), password: TEST_PASSWORD },
    });
    expect(res.status).toBe(200);
    expect(res.json.data.user).toMatchObject({ id: user.id, role: "OPERATOR" });
    expect(res.json.data.user).not.toHaveProperty("passwordHash");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    const cookie = sessionCookieFrom(res.headers);
    const profile = await call(me, { user: { ...user, cookie: cookie! } });
    expect(profile.status).toBe(200);
    expect(profile.json.data.email).toBe(user.email);
  });

  it("returns the same generic 401 for a wrong password and an unknown e-mail", async () => {
    const user = await createUser("OPERATOR");
    const wrong = await call(login, {
      method: "POST",
      body: { email: user.email, password: "nope-nope-nope" },
    });
    const unknown = await call(login, {
      method: "POST",
      body: { email: "nobody@test.local", password: TEST_PASSWORD },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json.error.message).toBe("Invalid email or password");
    expect(unknown.json.error.message).toBe(wrong.json.error.message);
  });

  it("rejects a disabled user", async () => {
    const user = await createUser("OPERATOR", "DISABLED");
    const res = await call(login, { method: "POST", body: { email: user.email, password: TEST_PASSWORD } });
    expect(res.status).toBe(401);
  });

  it("rejects login without an Origin header (login CSRF)", async () => {
    const user = await createUser("OPERATOR");
    const res = await call(login, {
      method: "POST",
      origin: null,
      body: { email: user.email, password: TEST_PASSWORD },
    });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("CSRF_REJECTED");
  });

  it("rate limits repeated attempts for the same e-mail (10 per 15 minutes)", async () => {
    const user = await createUser("OPERATOR");
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await call(login, {
        method: "POST",
        body: { email: user.email, password: "wrong-password" },
        headers: { "x-forwarded-for": `10.0.0.${i}` }, // different IPs: only the e-mail bucket applies
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("logout invalidates the session", async () => {
    const user = await createUser("VIEWER");
    expect((await call(me, { user })).status).toBe(200);
    const res = await call(logout, { method: "POST", user });
    expect(res.status).toBe(200);
    expect((await call(me, { user })).status).toBe(401);
  });

  it("purges expired sessions on the next successful login", async () => {
    const user = await createUser("VIEWER");
    await getDb()
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(sessions.userId, user.id));
    const res = await call(login, { method: "POST", body: { email: user.email, password: TEST_PASSWORD } });
    expect(res.status).toBe(200);
    const left = await getDb().select().from(sessions).where(eq(sessions.userId, user.id));
    expect(left).toHaveLength(1);
    expect(left[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects requests without a session", async () => {
    const res = await call(me);
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe("UNAUTHENTICATED");
  });
});

describe("health API", () => {
  it("reports ok and reveals nothing else", async () => {
    const res = await call(health);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ status: "ok", database: "up" });
  });
});
