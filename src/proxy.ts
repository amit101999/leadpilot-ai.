import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/cookie";
import { loginRedirectTarget } from "@/lib/auth/login-redirect";

/** Redirects page requests without a session cookie to /login. Real session checks happen server-side. */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const target = loginRedirectTarget(pathname, search, request.cookies.has(SESSION_COOKIE));
  if (!target) return NextResponse.next();
  return NextResponse.redirect(new URL(target, request.url));
}

export const config = {
  // Pages only: skip API routes (they authenticate per request), Next internals and static files.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
