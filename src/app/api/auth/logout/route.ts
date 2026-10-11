import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { assertSameOrigin, publicRoute } from "@/lib/http/api";
import { logout } from "@/modules/auth/service";

/** Public so an expired session can still clear its cookie. */
export const POST = publicRoute(async ({ req, db }) => {
  assertSameOrigin(req);
  await logout(db, req.cookies.get(SESSION_COOKIE)?.value);
  const response = NextResponse.json({ data: null });
  response.cookies.delete(SESSION_COOKIE);
  return response;
});
