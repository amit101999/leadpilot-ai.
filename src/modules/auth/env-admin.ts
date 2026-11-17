import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import type { Database } from "@/lib/database/client";
import { users } from "@/lib/database/schema";

/**
 * The admin login defined by ADMIN_USERNAME / ADMIN_PASSWORD. Sessions, profiles and import tokens all need a user
 * row, so the login keeps one ADMIN row for it. Its e-mail uses the reserved `.invalid` domain (RFC 2606): it can
 * never collide with a real address, never receives mail, and marks the row as managed by the server settings.
 * The password is only ever checked against ADMIN_PASSWORD; the row stores an unusable random hash.
 */
const ENV_ADMIN_DOMAIN = "env-admin.invalid";

export function envAdminEmail(username: string): string {
  return `${username.toLowerCase()}@${ENV_ADMIN_DOMAIN}`;
}

export function isEnvAdminEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${ENV_ADMIN_DOMAIN}`);
}

/** Constant-time comparison (hashing first makes the lengths equal). */
export function passwordMatches(expected: string, given: string): boolean {
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}

/** Returns the env admin's user row, creating it on first login. A disabled row stays disabled. */
export async function ensureEnvAdmin(db: Database, username: string) {
  const email = envAdminEmail(username);
  const columns = { id: users.id, email: users.email, role: users.role, status: users.status };
  const [existing] = await db.select(columns).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return existing;

  const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));
  await db
    .insert(users)
    .values({ email, name: username, passwordHash, role: "ADMIN", status: "ACTIVE" })
    .onConflictDoNothing();
  const [created] = await db.select(columns).from(users).where(eq(users.email, email)).limit(1);
  if (!created) throw new Error("env admin user could not be created");
  return created;
}
