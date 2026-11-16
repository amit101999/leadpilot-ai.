import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { publicRoute } from "@/lib/http/api";

/** Liveness for Docker and the reverse proxy. Deliberately reveals nothing beyond up/down. */
export const GET = publicRoute(async ({ db }) => {
  let database: "up" | "down" = "up";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) => {
        // 5 s: a serverless database (Neon) can take a few seconds to wake from idle.
        timer = setTimeout(() => reject(new Error("timeout")), 5000);
      }),
    ]);
  } catch {
    database = "down";
  } finally {
    clearTimeout(timer);
  }
  const status = database === "up" ? "ok" : "degraded";
  return NextResponse.json(
    { status, database },
    { status: database === "up" ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
});
