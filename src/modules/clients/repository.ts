import { eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@/lib/database/client";
import { clients } from "@/lib/database/schema";
import type { NormalizedClient } from "@/modules/job-sources/types";
import { storedClientSchema } from "@/modules/job-sources/upwork-import/normalize";

export type ClientRow = typeof clients.$inferSelect;

/**
 * Inserts or refreshes a client by its stable (source, source_client_id) identity. Values from the
 * latest job-detail call win; a value the latest call did not supply keeps the stored one.
 */
export async function upsertClient(
  db: DbExecutor,
  source: string,
  client: NormalizedClient,
): Promise<string> {
  const values = {
    source,
    sourceClientId: client.sourceClientId,
    country: client.country,
    state: client.state,
    timezone: client.timezone,
    paymentVerified: client.paymentVerified,
    rating: client.rating,
    reviewsCount: client.reviewsCount,
    totalSpent: client.totalSpent,
    totalHires: client.totalHires,
    jobsWithHires: client.jobsWithHires,
    activeContracts: client.activeContracts,
    hoursTotal: client.hoursTotal,
    jobsPosted: client.jobsPosted,
    openJobs: client.openJobs,
    hireRatePercent: client.hireRatePercent,
    recentReviews: client.recentReviews,
    workHistory: client.workHistory,
    otherOpenJobs: client.otherOpenJobs,
  };
  const refreshed = Object.fromEntries(
    Object.keys(values)
      .filter((key) => key !== "source" && key !== "sourceClientId")
      .map((key) => {
        const column = clients[key as keyof typeof values].name;
        return [key, sql.raw(`coalesce(excluded."${column}", "clients"."${column}")`)];
      }),
  );
  const [row] = await db
    .insert(clients)
    .values(values)
    .onConflictDoUpdate({
      target: [clients.source, clients.sourceClientId],
      set: { ...refreshed, lastSeenAt: sql`now()` },
    })
    .returning({ id: clients.id });
  if (!row) throw new Error("Client upsert returned no row");
  return row.id;
}

export async function getClient(db: DbExecutor, id: string): Promise<ClientRow | null> {
  const [row] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  return row ?? null;
}

/** A stored client as the provider-neutral record. Malformed jsonb lists read as empty, never fail. */
export function rowToClient(row: ClientRow): NormalizedClient {
  const lists = storedClientSchema
    .pick({ recentReviews: true, workHistory: true, otherOpenJobs: true })
    .safeParse({
      recentReviews: row.recentReviews,
      workHistory: row.workHistory,
      otherOpenJobs: row.otherOpenJobs,
    });
  return {
    sourceClientId: row.sourceClientId,
    country: row.country,
    state: row.state,
    timezone: row.timezone,
    paymentVerified: row.paymentVerified,
    rating: row.rating,
    reviewsCount: row.reviewsCount,
    totalSpent: row.totalSpent,
    totalHires: row.totalHires,
    jobsWithHires: row.jobsWithHires,
    activeContracts: row.activeContracts,
    hoursTotal: row.hoursTotal,
    jobsPosted: row.jobsPosted,
    openJobs: row.openJobs,
    hireRatePercent: row.hireRatePercent,
    recentReviews: lists.success ? lists.data.recentReviews : [],
    workHistory: lists.success ? lists.data.workHistory : { open: [], closed: [] },
    otherOpenJobs: lists.success ? lists.data.otherOpenJobs : [],
  };
}
