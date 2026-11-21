/**
 * Runs once per server process, before the first request is handled (Next.js loads it on that request).
 *
 * With MIGRATE_ON_START=true it applies pending database migrations first. That is for hosts without a separate
 * migration step (Render's free plan has no pre-deploy command); locally, `npm run db:migrate` does the same.
 * A failed migration (all pending migrations run in one transaction) exits the process, so the deploy fails and
 * Render keeps the previous version live; a half-migrated schema is never served. Run only one instance with this on:
 * migrations are not locked against concurrent runners. Columns are dropped in the same release that stops using
 * them (0005, 0006), so rolling back past such a migration also needs the database restored.
 *
 * E2E_FAKE_PROVIDERS=1 is for the browser tests only: it replaces the job source, AI and e-mail with the
 * test fakes. It is refused unless APP_BASE_URL is a localhost address, so it can never take effect on a
 * deployed site: the hook then throws, and Next.js answers every request, including /api/health, with an error.
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
