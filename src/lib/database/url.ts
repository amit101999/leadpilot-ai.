/**
 * libpq connection-string options that the postgres.js driver does not understand. postgres.js forwards unknown
 * query parameters to the server as runtime settings, and the server then refuses the connection
 * ("unrecognized configuration parameter"). Neon's default connection string includes channel_binding=require.
 */
const UNSUPPORTED_PARAMS = ["channel_binding"];

/**
 * postgres.js turns these sslmode values into TLS without certificate checks (rejectUnauthorized: false), so the
 * connection is encrypted but the server is not authenticated. Neon's default string says sslmode=require.
 */
const UNVERIFIED_SSL_MODES = new Set(["require", "prefer", "allow"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Returns the connection string without options postgres.js cannot pass on, and with certificate verification
 * (sslmode=verify-full) for a remote database. Other parts, and local connection strings, are left untouched.
 */
export function normalizeDatabaseUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url; // Not a URL: let the driver report it.
  }
  let changed = false;
  for (const name of UNSUPPORTED_PARAMS) {
    if (parsed.searchParams.has(name)) {
      parsed.searchParams.delete(name);
      changed = true;
    }
  }
  const sslmode = parsed.searchParams.get("sslmode");
  if (sslmode && UNVERIFIED_SSL_MODES.has(sslmode) && !LOCAL_HOSTS.has(parsed.hostname)) {
    parsed.searchParams.set("sslmode", "verify-full");
    changed = true;
  }
  return changed ? parsed.toString() : url;
}
