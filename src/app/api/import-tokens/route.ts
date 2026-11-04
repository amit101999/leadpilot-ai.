import { NextResponse } from "next/server";
import { parseJson, userRoute } from "@/lib/http/api";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { createImportToken, createImportTokenSchema, listImportTokens } from "@/modules/imports/tokens";

export const GET = userRoute("OPERATOR", async ({ db, actor }) => listImportTokens(db, actor));

/** Returns the new token once in `data.token`; it cannot be retrieved again. */
export const POST = userRoute("OPERATOR", async ({ req, db, actor, requestId }) => {
  await enforceRateLimit(db, RATE_LIMITS.importTokenCreate, `user:${actor.id}`);
  const input = await parseJson(req, createImportTokenSchema);
  const created = await createImportToken(db, actor, input, requestId);
  return NextResponse.json({ data: created }, { status: 201, headers: { "cache-control": "no-store" } });
});
