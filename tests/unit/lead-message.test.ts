import { describe, expect, it } from "vitest";
import {
  buildLeadEmail,
  buildRunSummaryEmail,
  oneLine,
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

/** The "Label: value" lines of the plain-text e-mail. */
function lines(input: LeadMessageInput, format: "STANDARD" | "COMPACT" = "STANDARD") {
  return buildLeadEmail(input, format).text.split("\n");
}

describe("oneLine", () => {
  it("removes newlines and tabs and collapses runs of spaces", () => {
    expect(oneLine("line one\nline two\t\ttabbed     spaced")).toBe("line one line two tabbed spaced");
  });

  it("truncates to the limit with an ellipsis and never returns an empty value", () => {
    expect(oneLine("abcdefghij", 5)).toBe("abcd…");
    expect(oneLine("   \n ")).toBe("-");
  });
});

describe("buildLeadEmail text", () => {
  it("lists the lead's fields in order", () => {
    expect(lines(lead())).toEqual([
      "New qualified Upwork lead",
      "",
      "Job title: React dashboard with Zoho CRM sync",
      "Budget: USD 800",
      "Job type: Fixed price",
      "Payment verified: Yes",
      "Matched skills: React, Zoho CRM",
      "AI match score: 88/100",
      "Reason: Strong match on React and Zoho CRM with a clear scope.",
      "Job URL: https://www.upwork.com/jobs/~0123",
      "Details: https://leadpilot.example.com/jobs/1",
    ]);
  });

  it("shows the hourly rate for hourly jobs", () => {
    const hourly = (hourlyMin: string, hourlyMax: string | null) =>
      lines(lead({ budgetType: "HOURLY", budgetAmount: null, budgetMax: null, hourlyMin, hourlyMax }))[3];
    expect(hourly("15.00", "30.00")).toBe("Budget: USD 15 - USD 30 /hr");
    expect(hourly("25.00", null)).toBe("Budget: USD 25+ /hr");
  });

  it("shows budget ranges, unknown values and risk flags", () => {
    const text = lines(
      lead({
        budgetAmount: "1000",
        budgetMax: "2500",
        budgetType: "UNKNOWN",
        paymentVerified: null,
        skills: [],
        riskFlags: [{ code: "VAGUE_SCOPE", severity: "MEDIUM", evidence: "No deliverables listed" }],
      }),
    );
    expect(text.slice(3, 7)).toEqual([
      "Budget: USD 1,000 - USD 2,500",
      "Job type: Unknown",
      "Payment verified: Unknown",
      "Matched skills: -",
    ]);
    expect(text).toContain("Risks: VAGUE_SCOPE (MEDIUM)");
  });

  it("shortens the reason in the compact format", () => {
    const reason = "x".repeat(200);
    const reasonLine = (format: "STANDARD" | "COMPACT") =>
      lines(lead({ reason }), format).find((l) => l.startsWith("Reason: "))!;
    expect(reasonLine("COMPACT")).toHaveLength("Reason: ".length + 80);
    expect(reasonLine("STANDARD")).toHaveLength("Reason: ".length + 200);
  });

  it("keeps a job title with line breaks on one line", () => {
    expect(lines(lead({ title: "Title\nInjected: line" }))).toContain("Job title: Title Injected: line");
  });

  it("omits the risks line when there are none and the details link when no dashboard URL is set", () => {
    const { text } = buildLeadEmail(lead({ dashboardUrl: null }), "STANDARD");
    expect(text).not.toContain("Risks:");
    expect(text).not.toContain("Details:");
  });
});

describe("buildRunSummaryEmail", () => {
  it("lists the run counts and links the run", () => {
    const { subject, text, html } = buildRunSummaryEmail({
      status: "COMPLETED_WITH_ERRORS",
      discovered: 18,
      qualified: 8,
      rejected: 10,
      notified: 5,
      failedNotifications: 1,
      runUrl: "https://leadpilot.example.com/history/1",
    });
    expect(subject).toBe("LeadPilot run COMPLETED_WITH_ERRORS");
    expect(text.split("\n")).toEqual([
      "LeadPilot run summary",
      "Status: COMPLETED_WITH_ERRORS",
      "Jobs discovered: 18",
      "Qualified: 8",
      "Rejected: 10",
      "Alerts sent: 5",
      "Delivery failures: 1",
      "Details: https://leadpilot.example.com/history/1",
    ]);
    expect(html).toContain('href="https://leadpilot.example.com/history/1"');
  });
});
