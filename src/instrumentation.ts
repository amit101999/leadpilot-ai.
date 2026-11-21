/**
 * Runs once when the Next.js server starts, before it handles requests.
 *
 * With MIGRATE_ON_START=true it applies pending database migrations first. That is for hosts without a separate
 * migration step (Render's free plan has no pre-deploy command); locally, `npm run db:migrate` does the same.
 * A failed migration stops the server, so a deploy never serves a half-migrated
 * schema. Run only one instance with this on: migrations are not locked against concurrent runners.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.MIGRATE_ON_START !== "true") return;
  const { runMigrations } = await import("@/lib/database/migrate-on-start");
  await runMigrations();
}
