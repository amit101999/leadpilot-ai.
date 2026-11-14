import { describe, expect, it } from "vitest";
import { defaultProfileConfig } from "@/modules/profiles/config-schema";
import { diffConfigs } from "@/modules/profiles/diff";

describe("diffConfigs", () => {
  it("returns nothing for identical configurations", () => {
    expect(diffConfigs(defaultProfileConfig(null), defaultProfileConfig(null))).toEqual([]);
  });

  it("describes changed fields in plain language", () => {
    const before = defaultProfileConfig(null);
    const after = defaultProfileConfig(null);
    after.budget.fixedMin = "750.00";
    after.budget.jobType = "BOTH";
    after.client.paymentVerificationRequired = false;
    after.skills.excludeKeywords = ["WordPress", "Shopify"];

    const changes = diffConfigs(before, after);
    expect(changes.map((c) => c.label)).toEqual([
      "Exclude keywords",
      "Job type",
      "Minimum budget",
      "Payment verification",
    ]);
    expect(changes.find((c) => c.label === "Minimum budget")).toMatchObject({
      before: "$500",
      after: "$750",
    });
    expect(changes.find((c) => c.label === "Job type")).toMatchObject({
      before: "Fixed-price only",
      after: "Fixed-price and hourly",
    });
    expect(changes.find((c) => c.label === "Payment verification")).toMatchObject({
      before: "Required",
      after: "Not required",
    });
    expect(changes.find((c) => c.label === "Exclude keywords")).toMatchObject({
      before: "None",
      after: "WordPress, Shopify",
    });
  });

  it("shows skills with their alternative spellings and weights individually", () => {
    const before = defaultProfileConfig(null);
    const after = defaultProfileConfig(null);
    after.skills.required = [{ name: "Vue", aliases: ["Vue.js"] }];
    after.ai.weights = { ...after.ai.weights, skillAlignment: 45, overallRelevance: 0 };
    const changes = diffConfigs(before, after);
    expect(changes.find((c) => c.label === "Required skills")?.after).toBe("Vue (Vue.js)");
    expect(changes.find((c) => c.label === "Weight: skill alignment")).toMatchObject({
      before: "35",
      after: "45",
    });
    expect(changes.find((c) => c.label === "Weight: overall relevance")).toMatchObject({
      before: "10",
      after: "0",
    });
  });

  it("names the recipient instead of showing an id", () => {
    const before = defaultProfileConfig(null);
    const after = defaultProfileConfig("7d0c2b9a-2c5e-4c1f-9a3e-1b2c3d4e5f60");
    const changes = diffConfigs(before, after, () => "Amit (masked)");
    expect(changes.find((c) => c.label === "E-mail recipient")).toMatchObject({
      before: "None",
      after: "Amit (masked)",
    });
    expect(changes.find((c) => c.label === "E-mail alerts")).toMatchObject({ before: "Off", after: "On" });
  });
});
