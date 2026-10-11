import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/configuration/env";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
/** A database handle or an open transaction; repositories accept either. */
export type DbExecutor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

type Holder = { sql?: postgres.Sql; db?: Database };
const globalHolder = globalThis as unknown as { __leadpilotDb?: Holder };
const holder: Holder = (globalHolder.__leadpilotDb ??= {});

export function getDb(): Database {
  if (!holder.db) {
    const config = env();
    holder.sql = postgres(config.DATABASE_URL, {
      max: config.DATABASE_POOL_MAX,
      idle_timeout: 30,
      connect_timeout: 10,
      onnotice: () => undefined,
    });
    holder.db = drizzle(holder.sql, { schema });
  }
  return holder.db;
}

export async function closeDb(): Promise<void> {
  if (holder.sql) {
    await holder.sql.end({ timeout: 5 });
    holder.sql = undefined;
    holder.db = undefined;
  }
}
