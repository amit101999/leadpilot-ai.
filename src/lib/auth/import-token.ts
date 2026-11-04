import { createHmac, randomBytes } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { env } from "@/lib/configuration/env";
import type { DbExecutor } from "@/lib/database/client";
import { importTokens, users } from "@/lib/database/schema";
import type { UserRole } from "@/types/domain";

/** Prefix makes leaked tokens recognisable (e.g. by secret scanners) and distinct from session tokens. */
export const IMPORT_TOKEN_PREFIX = "lpi_";
const TOKEN_RE = /^lpi_[A-Za-z0-9_-]{43}$/;

/** Domain-separated from session hashing so the two token kinds can never be confused. */
export function hashImportToken(token: string): string {
  return createHmac("sha256", env().AUTH_SECRET).update(`import-token:${token}`).digest("hex");
}

export function generateImportToken(): string {
  return `${IMPORT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export interface ImportTokenUser {
  tokenId: string;
  userId: string;
  role: UserRole;
}

/** Resolves an active (not revoked) token of an active user, or null. */
export async function resolveImportToken(db: DbExecutor, token: string | null): Promise<ImportTokenUser | null> {
  if (!token || !TOKEN_RE.test(token)) return null;
  const [row] = await db
    .select({ tokenId: importTokens.id, userId: users.id, role: users.role })
    .from(importTokens)
    .innerJoin(users, eq(users.id, importTokens.userId))
    .where(
      and(
        eq(importTokens.tokenHash, hashImportToken(token)),
        isNull(importTokens.revokedAt),
        eq(users.status, "ACTIVE"),
      ),
    )
    .limit(1);
  if (!row) return null;
  // Throttled usage tracking: at most one write per 5 minutes per token.
  await db
    .update(importTokens)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(importTokens.id, row.tokenId),
        or(isNull(importTokens.lastUsedAt), lt(importTokens.lastUsedAt, new Date(Date.now() - 300_000))),
      ),
    );
  return row;
}
