/**
 * libpq connection-string options that the postgres.js driver does not understand. postgres.js forwards unknown
 * query parameters to the server as runtime settings, and the server then refuses the connection
 * ("unrecognized configuration parameter"). Neon's default connection string includes channel_binding=require.
 */
const UNSUPPORTED_PARAMS = ["channel_binding"];

/** Returns the connection string without options postgres.js cannot pass on. Other parts are left untouched. */
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
  return changed ? parsed.toString() : url;
}
