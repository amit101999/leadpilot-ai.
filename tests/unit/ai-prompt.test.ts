import { describe, expect, it } from "vitest";
import type { EvaluationInput } from "@/modules/ai/evaluator";
import { buildUserMessage, PROMPT_VERSION } from "@/modules/ai/prompts/v2";
import { normalizeUpworkMcpJob, upworkMcpJobSchema } from "@/modules/job-sources/upwork-import/normalize";
import detailsHourly from "../fixtures/upwork/details-hourly.json";
import searchHourly from "../fixtures/upwork/search-hourly.json";
import { makeJob } from "../fixtures/jobs";

const profile: EvaluationInput["profile"] = {
  requiredSkills: ["Zoho"],
  optionalSkills: [],
  category: null,
  riskSensitivity: "MEDIUM",
};

/** The JSON object inside the JOB_DATA block. */
function jobData(message: string): Record<string, unknown> {
  const block = message.split("<<<JOB_DATA\n")[1]!.split("\nJOB_DATA>>>")[0]!;
  return JSON.parse(block) as Record<string, unknown>;
}

describe("AI prompt v2", () => {
  const job = normalizeUpworkMcpJob(upworkMcpJobSchema.parse({ ...searchHourly, details: detailsHourly }));
  const message = buildUserMessage({ job, profile });

  it("is a new prompt version, so earlier scores stay attributable to v1", () => {
    expect(PROMPT_VERSION).toBe("lead-eval-v2");
  });

  it("gives the model the client's hiring record and the posting's terms and activity", () => {
    const data = jobData(message);
    expect(data.client).toMatchObject({
      rating: "4.99",
      reviews: 16,
      hires: 33,
      hire_rate_percent: 77,
      total_spent: "34285.90",
      hours_paid: "3606.17",
      active_contracts: 7,
      jobs_posted: 35,
      timezone: "America/New_York",
    });
    expect(data).toMatchObject({
      experience_level: "Expert",
      workload: "Part time",
      proposals_tier: "50+",
      connects_to_apply: 26,
      hiring_activity: { invites_sent: 39, interviewing: 25, offers_made: 0, hires_made: 0 },
    });
  });

  it("never sends the client's reviews, contract titles or other job titles", () => {
    for (const review of job.client!.recentReviews) expect(message).not.toContain(review.comment);
    for (const contract of [...job.client!.workHistory.open, ...job.client!.workHistory.closed]) {
      expect(message).not.toContain(contract.title);
    }
  });

  it("marks client facts unknown instead of inventing them when no client record exists", () => {
    const data = jobData(buildUserMessage({ job: makeJob({ clientRating: null, client: null }), profile }));
    expect(data.client).toMatchObject({
      rating: "unknown",
      hire_rate_percent: "unknown",
      hours_paid: "unknown",
    });
    expect(data).toMatchObject({ experience_level: "unknown", connects_to_apply: "unknown" });
  });
});
