/**
 * URL validation for source-provided job links. Job URLs are displayed and
 * sent in notifications but never fetched by the server.
 */

/** Hosts a source is allowed to link to. Unknown sources have no allowed hosts (fail closed). */
const SOURCE_URL_HOSTS: Record<string, readonly string[]> = {
  upwork: ["www.upwork.com", "upwork.com"],
  // The mock source uses the reserved example.com domain so a mock URL can never
  // be mistaken for (or collide with) a real Upwork posting.
  mock: ["example.com"],
};

export type UrlValidation = { ok: true; url: string } | { ok: false; reason: string };

export function validateJobUrl(raw: string | null | undefined, source: string): UrlValidation {
  if (!raw) return { ok: false, reason: "URL_MISSING" };
  if (raw.length > 2048) return { ok: false, reason: "URL_TOO_LONG" };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "URL_MALFORMED" };
  }
  if (parsed.protocol !== "https:") return { ok: false, reason: "URL_NOT_HTTPS" };
  if (parsed.username || parsed.password) return { ok: false, reason: "URL_HAS_CREDENTIALS" };
  if (parsed.port !== "") return { ok: false, reason: "URL_CUSTOM_PORT" };
  const allowed = SOURCE_URL_HOSTS[source] ?? [];
  if (!allowed.includes(parsed.hostname.toLowerCase())) return { ok: false, reason: "URL_HOST_NOT_ALLOWED" };
  return { ok: true, url: parsed.toString() };
}

/** Only http(s) links may be rendered as anchors in the UI. */
export function isSafeLinkHref(href: string | null | undefined): href is string {
  if (!href) return false;
  try {
    const parsed = new URL(href);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
