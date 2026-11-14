import { sql } from "drizzle-orm";
import { env } from "@/lib/configuration/env";
import type { Database } from "@/lib/database/client";
import { integrationStatus } from "@/lib/database/schema";
import { sanitizeErrorMessage } from "@/lib/security/sanitize";
import type { Providers } from "@/modules/providers";
import type { IntegrationState } from "@/types/domain";

/**
 * Integration health. Checks run only on an explicit "Test connection" request
 * and the result is stored in integration_status; reads return the stored
 * result (flagged stale after STALE_AFTER_MS) and never call external services.
 * Only non-secret data is stored or returned.
 */

export const INTEGRATIONS = ["database", "job_source", "ai", "email", "n8n"] as const;
export type IntegrationName = (typeof INTEGRATIONS)[number];

export const STALE_AFTER_MS = 60 * 60_000;
const N8N_TIMEOUT_MS = 5000;

interface CheckResult {
  state: IntegrationState;
  message: string;
  metadata: Record<string, unknown>;
}

/** Non-secret description of how each integration is configured right now. */
function describe(name: IntegrationName, providers: Providers): Record<string, unknown> {
  const config = env();
  switch (name) {
    case "database":
      return { kind: "postgresql" };
    case "job_source":
      return { provider: providers.jobSource.id, isMock: providers.jobSource.getCapabilities().isMock };
    case "ai":
      return { provider: providers.ai.id, model: providers.ai.model, isMock: providers.ai.isMock };
    case "email":
      return { provider: providers.email.id, isMock: providers.email.isMock };
    case "n8n":
      return { executor: config.RUN_EXECUTOR, configured: Boolean(config.N8N_BASE_URL) };
  }
}

async function runCheck(db: Database, providers: Providers, name: IntegrationName): Promise<CheckResult> {
  const metadata = describe(name, providers);
  switch (name) {
    case "database": {
      await db.execute(sql`select 1`);
      return { state: "CONNECTED", message: "Database reachable", metadata };
    }
    case "job_source": {
      const result = await providers.jobSource.checkConnection();
      return {
        state: result.state,
        message: result.message,
        metadata: { ...metadata, missing: result.missing },
      };
    }
    case "ai": {
      const result = await providers.ai.checkConnection();
      return { state: result.state, message: result.message, metadata };
    }
    case "email": {
      const result = await providers.email.checkConnection();
      return {
        state: result.state,
        message: result.message,
        metadata: { ...metadata, missing: result.missing },
      };
    }
    case "n8n":
      return checkN8n(metadata);
  }
}

async function checkN8n(metadata: Record<string, unknown>): Promise<CheckResult> {
  const config = env();
  if (!config.N8N_BASE_URL) {
    const message =
      config.RUN_EXECUTOR === "inprocess"
        ? "n8n is not configured; runs use the in-process executor"
        : "N8N_BASE_URL is not set";
    return { state: "NOT_CONFIGURED", message, metadata };
  }
  // Fixed path on a host taken from server configuration only (no user input reaches the URL).
  const url = new URL("/healthz", config.N8N_BASE_URL);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(N8N_TIMEOUT_MS) });
    return response.ok
      ? { state: "CONNECTED", message: "n8n is reachable", metadata }
      : { state: "UNAVAILABLE", message: `n8n health check returned HTTP ${response.status}`, metadata };
  } catch {
    return { state: "UNAVAILABLE", message: "n8n could not be reached", metadata };
  }
}

export async function checkIntegration(db: Database, providers: Providers, name: IntegrationName) {
  let result: CheckResult;
  try {
    result = await runCheck(db, providers, name);
  } catch (error) {
    result = {
      state: "UNAVAILABLE",
      message: sanitizeErrorMessage(error),
      metadata: describe(name, providers),
    };
  }
  const now = new Date();
  const healthy = result.state === "CONNECTED" || result.state === "MOCK";
  const failure = healthy ? null : sanitizeErrorMessage(result.message);
  await db
    .insert(integrationStatus)
    .values({
      provider: name,
      status: result.state,
      lastCheckedAt: now,
      lastSuccessAt: healthy ? now : null,
      sanitizedError: failure,
      metadata: { ...result.metadata, message: result.message },
    })
    .onConflictDoUpdate({
      target: integrationStatus.provider,
      set: {
        status: result.state,
        lastCheckedAt: now,
        lastSuccessAt: healthy ? now : sql`${integrationStatus.lastSuccessAt}`,
        sanitizedError: failure,
        metadata: { ...result.metadata, message: result.message },
        updatedAt: now,
      },
    });
  return (await getIntegrationStatuses(db, providers)).find((s) => s.name === name)!;
}

/** Stored results for every integration, plus its current (non-secret) configuration. */
export async function getIntegrationStatuses(db: Database, providers: Providers) {
  const rows = await db.select().from(integrationStatus);
  const byName = new Map(rows.map((r) => [r.provider, r]));
  return INTEGRATIONS.map((name) => {
    const row = byName.get(name);
    const checkedAt = row?.lastCheckedAt ?? null;
    return {
      name,
      configuration: describe(name, providers),
      status: row?.status ?? null,
      message: (row?.metadata as { message?: string } | undefined)?.message ?? null,
      lastCheckedAt: checkedAt,
      lastSuccessAt: row?.lastSuccessAt ?? null,
      error: row?.sanitizedError ?? null,
      stale: !checkedAt || Date.now() - checkedAt.getTime() > STALE_AFTER_MS,
    };
  });
}
