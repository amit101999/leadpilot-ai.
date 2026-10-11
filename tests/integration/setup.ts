import "dotenv/config";
import { afterAll, beforeAll } from "vitest";

/**
 * Integration tests run against a real Postgres database named by
 * TEST_DATABASE_URL (never the development database). Each test file starts
 * from empty tables; files run sequentially (see vitest.config.ts).
 */
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL is required for integration tests (see .env.example)");
if (testUrl === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL: tests truncate every table");
}
process.env.DATABASE_URL = testUrl;
process.env.APP_BASE_URL = "http://localhost:3000";
process.env.LOG_LEVEL = "silent";
process.env.AI_PROVIDER = "mock";
process.env.WHATSAPP_PROVIDER = "mock";
process.env.JOB_SOURCE_PROVIDER = "mock";
process.env.RUN_EXECUTOR = "inprocess";

beforeAll(async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const postgres = (await import("postgres")).default;
  const sql = postgres(testUrl, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "database/migrations" });
    const tables = await sql<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'public'`;
    if (tables.length > 0) {
      // TRUNCATE does not fire the row-level immutability triggers.
      await sql.unsafe(
        `truncate ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`,
      );
    }
  } finally {
    await sql.end();
  }
});

afterAll(async () => {
  const { closeDb } = await import("@/lib/database/client");
  await closeDb();
});
