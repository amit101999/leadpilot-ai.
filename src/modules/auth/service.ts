import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { verifyAgainstDummy, verifyPassword } from "@/lib/auth/password";
import { createSession, deleteSession } from "@/lib/auth/session";
import type { Database } from "@/lib/database/client";
import { users } from "@/lib/database/schema";
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
  await recordAudit(db, {
    actor: userActor(user.id),
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
    requestId: meta.requestId,
  });
  return { ...session, user: { id: user.id, email: user.email, role: user.role } };
}

export async function logout(db: Database, token: string | undefined): Promise<void> {
  await deleteSession(db, token);
}

function hashForBucket(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}
