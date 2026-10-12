import "dotenv/config";
import { execFileSync } from "node:child_process";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { hash } from "@node-rs/argon2";
import { E2E_ADMIN, E2E_OPERATOR } from "../../playwright.config";

/** Fresh schema and a known admin in the test database before the browser tests run. */
export default async function globalSetup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL!;
  if (url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL");
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "database/migrations" });
    const tables = await sql<
      { tablename: string }[]
    >`select tablename from pg_tables where schemaname = 'public'`;
    if (tables.length > 0) {
      await sql.unsafe(
        `truncate ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`,
      );
    }
  } finally {
    await sql.end();
  }
  execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "database/seeds/seed.ts"], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: url,
      SEED_ADMIN_EMAIL: E2E_ADMIN.email,
      SEED_ADMIN_PASSWORD: E2E_ADMIN.password,
      WHATSAPP_DEFAULT_RECIPIENT: "",
    },
  });

  // A second, non-admin user (the seed only creates the admin).
  const db = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    const passwordHash = await hash(E2E_OPERATOR.password, {
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });
    await db`insert into users (email, name, password_hash, role)
             values (${E2E_OPERATOR.email}, 'E2E Operator', ${passwordHash}, 'OPERATOR')`;
  } finally {
    await db.end();
  }
}
