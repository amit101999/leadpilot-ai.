import { createHmac, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { env } from "@/lib/configuration/env";
import type { DbExecutor } from "@/lib/database/client";
import { sessions, users } from "@/lib/database/schema";
import type { UserRole } from "@/types/domain";

/** `__Host-` prefix in production forces Secure, Path=/ and no Domain attribute. */
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-lp_session" : "lp_session";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  sessionId: string;
}

/** Only an HMAC of the token is stored, so a database leak does not expose live sessions. */
function hashToken(token: string): string {
  return createHmac("sha256", env().AUTH_SECRET).update(token).digest("hex");
}

export async function createSession(
  db: DbExecutor,
  userId: string,
  meta: { ipAddress?: string | null; userAgent?: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env().SESSION_TTL_HOURS * 3600_000);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    ipAddress: meta.ipAddress?.slice(0, 64) ?? null,
    userAgent: meta.userAgent?.slice(0, 256) ?? null,
  });
  return { token, expiresAt };
}

export async function resolveSession(db: DbExecutor, token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length > 128) return null;
  const now = new Date();
  const rows = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now), eq(users.status, "ACTIVE")))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Throttled activity tracking: at most one write per 5 minutes per session.
  if (now.getTime() - row.lastSeenAt.getTime() > 5 * 60_000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role, sessionId: row.sessionId };
}

export async function deleteSession(db: DbExecutor, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function deleteExpiredSessions(db: DbExecutor): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}
