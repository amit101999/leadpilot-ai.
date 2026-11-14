/**
 * Validates LEADPILOT_URL before the import token is sent to it. The token is a bearer credential,
 * so it may only travel over HTTPS; plain HTTP is allowed for loopback addresses (local development).
 * Returns the base URL without a trailing slash, or throws an Error with a readable reason.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function resolveLeadPilotUrl(value) {
  const raw = (value ?? "http://localhost:3000").trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("LEADPILOT_URL is not a valid URL");
  }
  if (url.username || url.password) throw new Error("LEADPILOT_URL must not contain credentials");
  if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("LEADPILOT_URL must use https:// (http:// is allowed only for localhost)");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("LEADPILOT_URL must use https://");
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}
