import { NextResponse } from "next/server";
import { publicRoute } from "@/lib/http/api";

/**
 * Liveness for Render's health check, the Docker image and the browser tests: the process is up and its
 * configuration is valid (publicRoute validates the environment, so a missing setting still fails a deploy).
 * It does not query the database, so a slow or waking Neon database never makes the host restart a healthy app;
 * /api/ready reports the database. Startup migrations (MIGRATE_ON_START) still fail a deploy whose database is
 * unreachable. Deliberately reveals nothing beyond "ok".
 */
export const GET = publicRoute(async () =>
  NextResponse.json({ status: "ok" }, { headers: { "cache-control": "no-store" } }),
);
