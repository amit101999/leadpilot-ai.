import { describe, expect, it } from "vitest";
import {
  buildLeadMessage,
  buildRunSummaryMessage,
  templateParam,
  type LeadMessageInput,
} from "@/modules/notifications/message";

function lead(overrides: Partial<LeadMessageInput> = {}): LeadMessageInput {
  return {
    title: "React dashboard with Zoho CRM sync",
    budgetAmount: "800.00",
    budgetMax: null,
    currency: "USD",
    budgetType: "FIXED",
    paymentVerified: true,
    skills: ["React", "Zoho CRM"],
    score: 88,
    reason: "Strong match on React and Zoho CRM with a clear scope.",
    riskFlags: [],
    jobUrl: "https://www.upwork.com/jobs/~0123",
    dashboardUrl: "https://leadpilot.example.com/jobs/1",
    ...overrides,
  };
}

describe("templateParam (WhatsApp template rules)", () => {
  it("removes newlines and tabs and collapses runs of spaces", () => {
    expect(templateParam("line one\nline two\t\ttabbed     spaced")).toBe("line one line two tabbed spaced");
  });

  it("truncates to the limit with an ellipsis and never returns an empty parameter", () => {
    expect(templateParam("abcdefghij", 5)).toBe("abcd…");
    expect(templateParam("   \n ")).toBe("-");
  });
});

describe("buildLeadMessage", () => {
  it("fills the nine template parameters in the approved order", () => {
    const { templateParams } = buildLeadMessage(lead(), "STANDARD");
    expect(templateParams).toEqual([
      "React dashboard with Zoho CRM sync",
      "USD 800",
      "Fixed price",
      "Yes",
      "React, Zoho CRM",
      "88/100",
      "Strong match on React and Zoho CRM with a clear scope.",
      "None",
      "https://www.upwork.com/jobs/~0123",
    ]);
  });

  it("shows budget ranges, unknown values and risk flags", () => {
    const { templateParams, previewText } = buildLeadMessage(
      lead({
        budgetAmount: "1000",
        budgetMax: "2500",
        budgetType: "UNKNOWN",
        paymentVerified: null,
        skills: [],
        riskFlags: [{ code: "VAGUE_SCOPE", severity: "MEDIUM", evidence: "No deliverables listed" }],
      }),
      "STANDARD",
    );
    expect(templateParams.slice(1, 5)).toEqual(["USD 1,000 - USD 2,500", "Unknown", "Unknown", "-"]);
    expect(templateParams[7]).toBe("VAGUE_SCOPE (MEDIUM)");
    expect(previewText).toContain("Risks: VAGUE_SCOPE (MEDIUM)");
  });

  it("shortens the reason in the compact format", () => {
    const reason = "x".repeat(200);
    expect(buildLeadMessage(lead({ reason }), "COMPACT").templateParams[6]).toHaveLength(80);
    expect(buildLeadMessage(lead({ reason }), "STANDARD").templateParams[6]).toHaveLength(200);
  });

  it("keeps a job title with line breaks on one line, so it cannot break the template", () => {
    const { templateParams, previewText } = buildLeadMessage(
      lead({ title: "Title\nInjected: line" }),
      "STANDARD",
    );
    expect(templateParams[0]).toBe("Title Injected: line");
    expect(previewText.split("\n")).toContain("Job title: Title Injected: line");
  });

  it("omits the risks line when there are none and the details link when no dashboard URL is set", () => {
    const { previewText } = buildLeadMessage(lead({ dashboardUrl: null }), "STANDARD");
    expect(previewText).not.toContain("Risks:");
    expect(previewText).not.toContain("Details:");
  });
});

describe("buildRunSummaryMessage", () => {
  it("lists the run counts in template order", () => {
    const { templateParams } = buildRunSummaryMessage({
      status: "COMPLETED_WITH_ERRORS",
      discovered: 18,
      qualified: 8,
      rejected: 10,
      notified: 5,
      failedNotifications: 1,
      runUrl: "https://leadpilot.example.com/history/1",
    });
    expect(templateParams).toEqual([
      "COMPLETED_WITH_ERRORS",
      "18",
      "8",
      "10",
      "5",
      "1",
      "https://leadpilot.example.com/history/1",
    ]);
  });
});
