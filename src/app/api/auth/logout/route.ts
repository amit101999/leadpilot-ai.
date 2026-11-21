import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { assertSameOrigin, publicRoute } from "@/lib/http/api";
import { logout } from "@/modules/auth/service";

/** Public so an expired session can still clear its cookie. */
export const POST = publicRoute(async ({ req, db }) => {
  assertSameOrigin(req);
  await logout(db, req.cookies.get(SESSION_COOKIE)?.value);
  const response = NextResponse.json({ data: null });
  // Same attributes as when it was set: browsers ignore a `__Host-` cookie without Secure, so a bare delete would
  // leave the stale cookie in place in production.
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
  return response;
});
