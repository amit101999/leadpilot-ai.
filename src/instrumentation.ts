/**
 * Runs once per server process, before the first request is handled (Next.js loads it on that request).
 *
 * With MIGRATE_ON_START=true it applies pending database migrations first. That is for hosts without a separate
 * migration step (Render's free plan has no pre-deploy command); locally, `npm run db:migrate` does the same.
 * If it throws (a failed migration, or the check below), Next.js answers every request with an error, including
 * the /api/health check, so Render keeps the previous version live and a half-migrated schema is never served. Run only one instance with this on: migrations are not locked against concurrent runners.
 *
 * E2E_FAKE_PROVIDERS=1 is for the browser tests only: it replaces the job source, AI and e-mail with the
 * test fakes. It is refused unless APP_BASE_URL is a localhost address, so it can never take effect on a
 * deployed site.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.E2E_FAKE_PROVIDERS === "1") {
    let host = "";
    try {
      host = new URL(process.env.APP_BASE_URL ?? "").hostname;
    } catch {
      // An invalid or missing APP_BASE_URL is not localhost.
    }
    if (!LOCAL_HOSTS.has(host)) {
      throw new Error("E2E_FAKE_PROVIDERS=1 is only allowed when APP_BASE_URL is a localhost address");
    }
    const [{ installTestProviders }, { createFakeProviders }] = await Promise.all([
      import("@/modules/providers"),
      import("../tests/fakes/providers"),
    ]);
    installTestProviders(createFakeProviders());
  }
  if (process.env.MIGRATE_ON_START !== "true") return;
  const { runMigrations } = await import("@/lib/database/migrate-on-start");
  await runMigrations();
}
