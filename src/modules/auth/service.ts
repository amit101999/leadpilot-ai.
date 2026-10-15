import { createHash } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyAgainstDummy, verifyPassword } from "@/lib/auth/password";
import { createSession, deleteExpiredSessions, deleteSession } from "@/lib/auth/session";
import type { Database } from "@/lib/database/client";
import { sessions, users } from "@/lib/database/schema";
import { AppError } from "@/lib/http/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { recordAudit, userActor } from "@/modules/audit/service";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** One message for every failure, so responses never reveal which accounts exist. */
const INVALID_CREDENTIALS = "Invalid email or password";

/**
 * Password login. Rate limited per client IP and per e-mail address (the e-mail
 * is hashed in the bucket key so it is not stored in clear text), and timing is
 * equalised for unknown accounts.
 */
export async function login(
  db: Database,
  input: LoginInput,
  meta: { ipAddress: string; userAgent: string | null; requestId?: string },
): Promise<{ token: string; expiresAt: Date; user: { id: string; email: string; role: string } }> {
  await enforceRateLimit(db, RATE_LIMITS.login, `ip:${meta.ipAddress}`);
  await enforceRateLimit(db, RATE_LIMITS.login, `email:${hashForBucket(input.email)}`);

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      status: users.status,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(sql`lower(${users.email}) = ${input.email}`)
    .limit(1);

  const valid = user
    ? await verifyPassword(user.passwordHash, input.password)
    : await verifyAgainstDummy(input.password);
  if (!user || !valid || user.status !== "ACTIVE") {
    throw new AppError("UNAUTHENTICATED", INVALID_CREDENTIALS);
  }

  const session = await createSession(db, user.id, { ipAddress: meta.ipAddress, userAgent: meta.userAgent });
  // Expired sessions are already rejected on lookup; purging them here keeps the table small without a scheduler.
  await deleteExpiredSessions(db);
  await recordAudit(db, {
    actor: userActor(user.id),
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
    requestId: meta.requestId,
  });
  return { ...session, user: { id: user.id, email: user.email, role: user.role } };
}

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password").max(256),
    newPassword: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
      .max(256, "Use at most 256 characters"),
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "The new password must be different from the current one",
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * Changes the signed-in user's password. The current password is required,
 * attempts are rate limited per user, and every other session of the user is
 * ended so a stolen session cannot outlive the change.
 */
export async function changePassword(
  db: Database,
  user: { id: string; sessionId: string },
  input: ChangePasswordInput,
  requestId?: string,
): Promise<{ otherSessionsEnded: number }> {
  await enforceRateLimit(db, RATE_LIMITS.passwordChange, `user:${user.id}`);
  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!row || !(await verifyPassword(row.passwordHash, input.currentPassword))) {
    throw new AppError("VALIDATION_ERROR", "The current password is not correct", [
      { path: "currentPassword", message: "The current password is not correct" },
    ]);
  }
  const passwordHash = await hashPassword(input.newPassword);
  return db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id));
    const ended = await tx
      .delete(sessions)
      .where(and(eq(sessions.userId, user.id), ne(sessions.id, user.sessionId)))
      .returning({ id: sessions.id });
    await recordAudit(tx, {
      actor: userActor(user.id),
      action: "auth.password_change",
      entityType: "user",
      entityId: user.id,
      after: { otherSessionsEnded: ended.length },
      requestId,
    });
    return { otherSessionsEnded: ended.length };
  });
}

export async function logout(db: Database, token: string | undefined): Promise<void> {
  await deleteSession(db, token);
}

function hashForBucket(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}
