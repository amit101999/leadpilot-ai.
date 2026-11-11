import { describe, expect, it } from "vitest";
import { chunkJobs, MAX_REQUEST_BYTES, slimJob } from "../../scripts/lib/import-payload.mjs";
import { upworkMcpJobSchema } from "@/modules/job-sources/upwork-import/normalize";

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
  client_feedback: { reviews: Array(5).fill({ comment: "long review text ".repeat(200) }) },
  client_work_history: { closed: Array(5).fill({ title: "Old contract" }) },
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
  it("keeps only the fields LeadPilot reads and caps descriptions", () => {
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
    expect(details).not.toHaveProperty("client_feedback");
    expect(details).not.toHaveProperty("client_work_history");
    expect(details.client_record).toEqual({ contracts_total: 151, hire_rate_percent: 70 });
    expect(details.data.marketplaceJobPosting).not.toHaveProperty("unknownBlock");
    expect(details.data.marketplaceJobPosting.content.description).toHaveLength(20_000);
    // The slimmed job is still a valid import item.
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
