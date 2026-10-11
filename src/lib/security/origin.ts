const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for cookie-authenticated routes. Session cookies are
 * SameSite=Lax; on top of that, every state-changing request must carry an
 * Origin header equal to the application's own origin. A missing or "null"
 * Origin is rejected (fail closed): browsers always send Origin on
 * cross-origin and same-origin fetch/XHR POSTs.
 */
export function isAllowedRequestOrigin(
  method: string,
  originHeader: string | null,
  appBaseUrl: string,
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  if (!originHeader || originHeader === "null") return false;
  try {
    return new URL(originHeader).origin === new URL(appBaseUrl).origin;
  } catch {
    return false;
  }
}
