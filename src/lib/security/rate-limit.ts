import { lt, sql } from "drizzle-orm";
import type { DbExecutor } from "@/lib/database/client";
import { rateLimits } from "@/lib/database/schema";
import { AppError } from "@/lib/http/errors";

export interface RateLimitRule {
  /** Logical bucket, e.g. "login" or "run-create". */
  name: string;
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  login: { name: "login", limit: 10, windowSeconds: 15 * 60 },
  passwordChange: { name: "password-change", limit: 5, windowSeconds: 15 * 60 },
  runCreate: { name: "run-create", limit: 10, windowSeconds: 60 },
  notificationRetry: { name: "notification-retry", limit: 20, windowSeconds: 60 },
  testMessage: { name: "test-message", limit: 3, windowSeconds: 10 * 60 },
  integrationCheck: { name: "integration-check", limit: 20, windowSeconds: 60 },
  export: { name: "export", limit: 10, windowSeconds: 60 },
  /** All import-token calls together; one sync makes a handful per profile. */
  importApi: { name: "import-api", limit: 60, windowSeconds: 60 },
  importTokenCreate: { name: "import-token-create", limit: 10, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;

/**
 * Fixed-window counter stored in Postgres so limits hold across multiple app
 * instances. One atomic upsert per request.
 */
export async function enforceRateLimit(db: DbExecutor, rule: RateLimitRule, subject: string): Promise<void> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const key = `${rule.name}:${subject}`.slice(0, 200);
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  // Opportunistic cleanup keeps the table small without a scheduler.
  if (Math.random() < 0.01) {
    await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(Date.now() - 24 * 3600_000)));
  }

  if ((row?.count ?? 0) > rule.limit) {
    const retryAfter = Math.ceil((windowStart.getTime() + windowMs - Date.now()) / 1000);
    throw new AppError("RATE_LIMITED", "Too many requests. Please try again later.", {
      retryAfterSeconds: retryAfter,
    });
  }
}
