/** Pages reachable without a session. API routes authenticate themselves and are not matched by the proxy. */
const PUBLIC_PAGES = new Set(["/login"]);

/**
 * Decides whether a page request must be sent to the login screen. This is an
 * optimistic check on cookie presence only; the session itself is validated
 * server-side (app layout and `userRoute`). Returns the redirect target, or
 * null to let the request through.
 */
export function loginRedirectTarget(
  pathname: string,
  search: string,
  hasSessionCookie: boolean,
): string | null {
  if (hasSessionCookie || PUBLIC_PAGES.has(pathname)) return null;
  const next = safeNextPath(pathname + search);
  return next && next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login";
}

/**
 * Accepts only same-origin relative paths, so `?next=` can never become an
 * open redirect ("//evil.example", "/\\evil.example", "https://...").
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || value.length > 2048) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/[\u0000-\u001f]/.test(value)) return null;
  return value;
}
