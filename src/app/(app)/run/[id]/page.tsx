import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RunProgress, type ProgressData } from "@/components/runs/run-progress";
import { hasRole } from "@/lib/auth/authorization";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/database/client";
import { AppError } from "@/lib/http/errors";
import { uuidParam } from "@/lib/validation/common";
import { getRunProgress } from "@/modules/runs/service";

export const metadata: Metadata = { title: "Run progress" };

export default async function RunProgressPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireUser();
  const id = uuidParam.safeParse((await params).id);
  if (!id.success) notFound();
  let progress;
  try {
    progress = await getRunProgress(getDb(), actor, id.data);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  // Same shape as GET /api/runs/:id/events, which the client polls.
  const { configurationSnapshot: _snapshot, leaseOwner: _lease, ...run } = progress.run;
  const initial = JSON.parse(
    JSON.stringify({ run, counters: progress.counters, terminal: progress.terminal }),
  ) as ProgressData;
  return <RunProgress runId={id.data} initial={initial} canOperate={hasRole(actor, "OPERATOR")} />;
}
