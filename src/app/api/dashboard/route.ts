import { NextResponse } from "next/server";
import { userRoute } from "@/lib/http/api";
import { getDashboard } from "@/modules/dashboard/service";
import { getProviders } from "@/modules/providers";

export const GET = userRoute("VIEWER", async ({ db, actor }) =>
  NextResponse.json(
    { data: await getDashboard(db, actor, getProviders()) },
    { headers: { "cache-control": "no-store" } },
  ),
);
