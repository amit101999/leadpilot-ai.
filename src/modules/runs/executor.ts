import { after } from "next/server";
import { env } from "@/lib/configuration/env";
import { getDb } from "@/lib/database/client";
import { logger } from "@/lib/logging/logger";
import { signPayload } from "@/lib/security/hmac";
import { getProviders } from "@/modules/providers";
import { runInProcess } from "./engine";

export type ExecutorKind = "n8n" | "inprocess";

export type DispatchResult = { ok: true } | { ok: false; error: string };

/**
 * Hands a queued run to the configured executor. For n8n the webhook is called
 * synchronously (it acknowledges immediately); for the in-process runner the
 * work is scheduled after the HTTP response is sent.
 */
export async function dispatchRun(runId: string, executor: ExecutorKind): Promise<DispatchResult> {
  if (executor === "inprocess") {
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
  return dispatchToN8n(runId);
}

async function dispatchToN8n(runId: string): Promise<DispatchResult> {
  const config = env();
  if (!config.N8N_BASE_URL || !config.N8N_WEBHOOK_SECRET) {
    return { ok: false, error: "n8n executor is not configured (N8N_BASE_URL / N8N_WEBHOOK_SECRET)" };
  }
  const body = JSON.stringify({ runId });
  // Fixed host from configuration + fixed path: no user input reaches the URL.
  const url = new URL(config.N8N_WEBHOOK_PATH, config.N8N_BASE_URL);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LeadPilot-Webhook-Secret": config.N8N_WEBHOOK_SECRET,
        "X-LeadPilot-Signature": signPayload(config.N8N_WEBHOOK_SECRET, body),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { ok: false, error: `n8n webhook responded with HTTP ${response.status}` };
    return { ok: true };
  } catch {
    return { ok: false, error: "n8n webhook could not be reached" };
  }
}
