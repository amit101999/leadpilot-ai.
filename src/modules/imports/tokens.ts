import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { generateImportToken, hashImportToken } from "@/lib/auth/import-token";
import { requireRole, type Actor } from "@/lib/auth/authorization";
import type { Database } from "@/lib/database/client";
import { importTokens } from "@/lib/database/schema";
import { notFound } from "@/lib/http/errors";
import { recordAudit, userActor } from "@/modules/audit/service";

export const createImportTokenSchema = z.object({ name: z.string().trim().min(1).max(80) });

/** Tokens are always the actor's own: there is no admin view of other users' tokens. */
export async function listImportTokens(db: Database, actor: Actor) {
  return db
    .select({
      id: importTokens.id,
      name: importTokens.name,
      lastUsedAt: importTokens.lastUsedAt,
      revokedAt: importTokens.revokedAt,
      createdAt: importTokens.createdAt,
    })
    .from(importTokens)
    .where(eq(importTokens.userId, actor.id))
    .orderBy(desc(importTokens.createdAt));
}

/** Returns the token once; only its HMAC is stored, so it cannot be shown again. */
export async function createImportToken(
  db: Database,
  actor: Actor,
  input: z.infer<typeof createImportTokenSchema>,
  requestId?: string,
) {
  requireRole(actor, "OPERATOR");
  const token = generateImportToken();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(importTokens)
      .values({ userId: actor.id, name: input.name, tokenHash: hashImportToken(token) })
      .returning({ id: importTokens.id, name: importTokens.name, createdAt: importTokens.createdAt });
    await recordAudit(tx, {
      actor: userActor(actor.id),
      action: "import_token.create",
      entityType: "import_token",
      entityId: row!.id,
      after: { name: input.name },
      requestId,
    });
    return { ...row!, token };
  });
}

export async function revokeImportToken(db: Database, actor: Actor, id: string, requestId?: string) {
  requireRole(actor, "OPERATOR");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(importTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(importTokens.id, id), eq(importTokens.userId, actor.id), isNull(importTokens.revokedAt)))
      .returning({ id: importTokens.id, name: importTokens.name, revokedAt: importTokens.revokedAt });
    if (!row) throw notFound("Active import token");
    await recordAudit(tx, {
      actor: userActor(actor.id),
      action: "import_token.revoke",
      entityType: "import_token",
      entityId: id,
      after: { name: row.name },
      requestId,
    });
    return row;
  });
}
