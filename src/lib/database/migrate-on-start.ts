import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { logger } from "@/lib/logging/logger";
import { normalizeDatabaseUrl } from "./url";

/** Applies pending SQL migrations from database/migrations (idempotent). Exits the process on failure. */
export async function runMigrations(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    logger.fatal("MIGRATE_ON_START is set but DATABASE_URL is missing");
    process.exit(1);
  }
  const sql = postgres(normalizeDatabaseUrl(url), { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(sql), { migrationsFolder: path.join(process.cwd(), "database", "migrations") });
    logger.info("Database migrations applied");
  } catch (error) {
    logger.fatal({ err: error }, "Database migration failed; stopping");
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
