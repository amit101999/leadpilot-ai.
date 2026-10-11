/**
 * Session cookie name, kept dependency-free so the edge `proxy.ts` can import
 * it without pulling in env parsing or the database layer.
 * `__Host-` prefix in production forces Secure, Path=/ and no Domain attribute.
 */
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-lp_session" : "lp_session";
