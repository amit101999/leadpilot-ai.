import { after } from "next/server";
import { getDb } from "@/lib/database/client";
import { logger } from "@/lib/logging/logger";
import { getProviders } from "@/modules/providers";
import { runInProcess } from "./engine";

export type DispatchResult = { ok: true } | { ok: false; error: string };

/**
 * Starts a queued run in this process, after the HTTP response is sent. Every step is idempotent and
 * lease-protected, so a run interrupted by a restart can be resumed.
 */
export async function dispatchRun(runId: string): Promise<DispatchResult> {
  const work = async () => {
    try {
      await runInProcess(getDb(), getProviders(), runId);
    } catch (error) {
      logger.error({ run_id: runId, err: error }, "In-process run crashed");
    }
  };
  try {
    after(work);
  } catch {
    // No request scope (e.g. a follow-up run started by a finishing run): run in the background.
    void work();
  }
  return { ok: true };
}
