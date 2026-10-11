import { z } from "zod";
import { jobProcessingStatus, notificationStatus, qualificationDecision } from "@/lib/database/schema";
import { isDecimalString } from "@/lib/money/decimal";
import { paginationQuery, q } from "@/lib/validation/common";

const amount = q.string(20).refine((v) => v === undefined || isDecimalString(v), "Invalid amount");

/** Qualified Leads filters. Shared by GET /api/leads and the leads CSV export. */
export const leadListQuery = z.object({
  ...paginationQuery,
  profileId: q.uuid(),
  decision: q.enumList(qualificationDecision.enumValues),
  budgetMin: amount,
  budgetMax: amount,
  scoreMin: q.int(0, 100),
  scoreMax: q.int(0, 100),
  skill: q.string(80),
  paymentVerified: q.enumOf(["true", "false", "unknown"] as const),
  discoveredFrom: q.date(),
  discoveredTo: q.date(),
  notificationStatus: q.enumList([...notificationStatus.enumValues, "NONE"] as const),
  search: q.string(200),
  sort: q.enumOf(["score", "firstSeen", "lastChecked", "budget"] as const),
});

/** All Jobs filters (GET /api/jobs). */
export const jobListQuery = z.object({
  ...paginationQuery,
  profileId: q.uuid(),
  status: q.enumList(jobProcessingStatus.enumValues),
  search: q.string(200),
  previouslySeen: q.bool(),
  notified: q.bool(),
  source: q.string(50),
  sort: q.enumOf(["firstSeen", "lastChecked", "budget", "score", "title"] as const),
});
