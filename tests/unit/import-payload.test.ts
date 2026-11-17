import { describe, expect, it } from "vitest";
import { chunkJobs, MAX_REQUEST_BYTES, slimJob } from "../../scripts/lib/import-payload.mjs";
import { upworkMcpJobSchema } from "@/modules/job-sources/upwork-import/normalize";
import detailsHourly from "../fixtures/upwork/details-hourly.json";
import searchHourly from "../fixtures/upwork/search-hourly.json";

const searchItem = {
  id: "2117399309499514919",
  title: "ZOHO and ZOHO Forms Specialist Needed",
  description: "x".repeat(50_000),
  url: "https://www.upwork.com/jobs/~022117399309499514919",
  job_type: "fixed",
  budget: "35.00",
  applied: false,
  featured: true,
  client: {
    country: "United States",
    rating: 4.81,
    total_spent: "$23,575.22",
    verification_status: "VERIFIED",
    extra: 1,
  },
};

/** Shape of a raw `find_jobs get` response, including the bulk the import never reads. */
const rawDetails = {
  client_record: { contracts_total: 151, hire_rate_percent: 70, hours_total: 1010 },
  client_feedback: {
    reviews: Array(8).fill({ title: "Job", comment: "long review text ".repeat(200), score: 5 }),
  },
  client_work_history: { closed: Array(8).fill({ title: "Old contract", reviewer_name: "dropped" }) },
  attachments: [{ fileName: "a.png", link: "https://bucket.s3.amazonaws.com/x?X-Amz-Security-Token=secret" }],
  data: {
    marketplaceJobPosting: {
      content: { description: "y".repeat(50_000) },
      contractTerms: {
        contractType: "FIXED",
        fixedPriceContractTerms: { amount: { currency: "USD", rawValue: "35.0" } },
      },
      unknownBlock: { a: 1 },
    },
  },
  connects_cost: 11,
};

describe("import payload slimming", () => {
  it("keeps only the fields LeadPilot reads and caps descriptions, lists and comments", () => {
    const slim = slimJob(searchItem, rawDetails);
    expect(slim).not.toHaveProperty("applied");
    expect(slim.client).toEqual({
      country: "United States",
      rating: 4.81,
      total_spent: "$23,575.22",
      verification_status: "VERIFIED",
    });
    expect(String(slim.description)).toHaveLength(20_000);
    const details = slim.details as {
      client_record: Record<string, unknown>;
      data: { marketplaceJobPosting: Record<string, unknown> & { content: { description: string } } };
    };
    expect(slim.featured).toBe(true);
    expect(details).not.toHaveProperty("attachments");
    expect(details.client_record).toEqual({ contracts_total: 151, hire_rate_percent: 70, hours_total: 1010 });
    const reviews = (details as unknown as { client_feedback: { reviews: { comment: string }[] } })
      .client_feedback.reviews;
    expect(reviews).toHaveLength(5);
    expect(reviews[0]!.comment).toHaveLength(2_000);
    const closed = (details as unknown as { client_work_history: { closed: object[] } }).client_work_history
      .closed;
    expect(closed).toHaveLength(5);
    expect(closed[0]).toEqual({ title: "Old contract" });
    expect(details.data.marketplaceJobPosting).not.toHaveProperty("unknownBlock");
    expect(details.data.marketplaceJobPosting.content.description).toHaveLength(20_000);
    // The slimmed job is still a valid import item.
    expect(upworkMcpJobSchema.safeParse(slim).success).toBe(true);
  });

  it("keeps a recorded live response's client and posting data but never its signed attachment links", () => {
    const slim = slimJob(searchHourly, detailsHourly);
    expect(JSON.stringify(slim)).not.toContain("X-Amz");
    expect(slim.job_activity).toEqual(searchHourly.job_activity);
    expect(slim.engagement).toBe("PART_TIME");
    const posting = (slim.details as { data: { marketplaceJobPosting: Record<string, unknown> } }).data
      .marketplaceJobPosting;
    expect(posting.clientCompanyPublic).toEqual({
      id: "1001859645",
      country: { name: "United States" },
      state: "PA",
      timezone: "America/New_York",
    });
    expect(posting.contractTerms).toMatchObject({
      experienceLevel: "EXPERT",
      personsToHire: 1,
      hourlyContractTerms: { engagementType: "PART_TIME", hourlyBudgetMin: 10, hourlyBudgetMax: 20 },
    });
    expect(upworkMcpJobSchema.safeParse(slim).success).toBe(true);
  });

  it("leaves jobs without details unchanged in shape", () => {
    expect(slimJob({ id: "1", title: "t" })).toStrictEqual({ id: "1", title: "t" });
  });
});

describe("request chunking", () => {
  it("never builds a request over the byte limit or the job limit", () => {
    const jobs = Array.from({ length: 30 }, (_, i) => slimJob({ ...searchItem, id: String(i) }, rawDetails));
    const chunks = chunkJobs(jobs);
    expect(chunks.flat()).toHaveLength(30);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(JSON.stringify(chunk))).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
    }
    expect(
      chunkJobs(Array.from({ length: 250 }, (_, i) => ({ id: String(i) }))).map((c) => c.length),
    ).toEqual([100, 100, 50]);
  });
});
