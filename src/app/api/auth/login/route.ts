import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { assertSameOrigin, clientIp, parseJson, publicRoute } from "@/lib/http/api";
import { login, loginSchema } from "@/modules/auth/service";

export const POST = publicRoute(async ({ req, db, requestId }) => {
  assertSameOrigin(req);
  const input = await parseJson(req, loginSchema);
  const session = await login(db, input, {
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    requestId,
  });
  const response = NextResponse.json({ data: { user: session.user } });
  response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  return response;
});
