import { createHash } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyAgainstDummy, verifyPassword } from "@/lib/auth/password";
import { createSession, deleteExpiredSessions, deleteSession } from "@/lib/auth/session";
import { env } from "@/lib/configuration/env";
import type { Database } from "@/lib/database/client";
import { sessions, users } from "@/lib/database/schema";
import { AppError } from "@/lib/http/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { recordAudit, userActor } from "@/modules/audit/service";
import { ensureEnvAdmin, isEnvAdminEmail, passwordMatches } from "./env-admin";

export const loginSchema = z.object({
  // An e-mail address, or the ADMIN_USERNAME (lower-cased here); the field name stays for API compatibility.
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

  const user = await findLoginUser(db, input);
  if (!user || user.status !== "ACTIVE") {
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

/**
 * Resolves the identifier and password to a user, or null. The identifier is either the ADMIN_USERNAME (checked
 * against ADMIN_PASSWORD, see env-admin.ts) or an e-mail address (checked against the stored argon2 hash). Rows
 * managed by the server settings can only sign in through the username, so an old password never outlives a change
 * of ADMIN_PASSWORD. Unknown accounts still run one argon2 verification so timing does not reveal them.
 */
async function findLoginUser(db: Database, input: LoginInput) {
  const config = env();
  if (config.ADMIN_USERNAME && config.ADMIN_PASSWORD && input.email === config.ADMIN_USERNAME) {
    if (!passwordMatches(config.ADMIN_PASSWORD, input.password)) {
      await verifyAgainstDummy(input.password);
      return null;
    }
    return ensureEnvAdmin(db, config.ADMIN_USERNAME);
  }

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
  if (!user || isEnvAdminEmail(user.email)) {
    await verifyAgainstDummy(input.password);
    return null;
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) return null;
  return { id: user.id, email: user.email, role: user.role, status: user.status };
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
    .select({ email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (row && isEnvAdminEmail(row.email)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "This account's password is set in the server settings (ADMIN_PASSWORD); change it there",
    );
  }
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
