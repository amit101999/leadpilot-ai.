import { formatMoney } from "@/lib/money/decimal";
import type { RiskFlag } from "@/modules/ai/output-schema";

export interface LeadMessageInput {
  title: string;
  budgetAmount: string | null;
  budgetMax: string | null;
  currency: string | null;
  budgetType: string;
  paymentVerified: boolean | null;
  skills: string[];
  score: number;
  reason: string;
  riskFlags: RiskFlag[];
  jobUrl: string;
  dashboardUrl: string | null;
}

/** WhatsApp template parameters cannot contain newlines/tabs or more than 4 consecutive spaces. */
export function templateParam(text: string, max = 200): string {
  const clean = text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  return (clean.length > max ? `${clean.slice(0, max - 1)}…` : clean) || "-";
}

/**
 * Builds the template parameters (order must match the approved template, see
 * docs/whatsapp.md) and a plain-text preview shown in the dashboard.
 */
export function buildLeadMessage(input: LeadMessageInput, format: "STANDARD" | "COMPACT") {
  const budget =
    input.budgetMax && input.budgetMax !== input.budgetAmount
      ? `${formatMoney(input.budgetAmount, input.currency)} - ${formatMoney(input.budgetMax, input.currency)}`
      : formatMoney(input.budgetAmount, input.currency);
  const jobType =
    input.budgetType === "FIXED" ? "Fixed price" : input.budgetType === "HOURLY" ? "Hourly" : "Unknown";
  const verified =
    input.paymentVerified === true ? "Yes" : input.paymentVerified === false ? "No" : "Unknown";
  const skills = input.skills.length > 0 ? input.skills.join(", ") : "-";
  const risks =
    input.riskFlags.length > 0 ? input.riskFlags.map((r) => `${r.code} (${r.severity})`).join(", ") : "None";

  const params = [
    templateParam(input.title),
    templateParam(budget, 60),
    templateParam(jobType, 20),
    templateParam(verified, 10),
    templateParam(skills),
    templateParam(`${input.score}/100`, 10),
    templateParam(format === "COMPACT" ? input.reason.slice(0, 80) : input.reason, 300),
    templateParam(risks),
    templateParam(input.jobUrl, 500),
  ];

  const lines = [
    "New qualified Upwork lead",
    "",
    `Job title: ${params[0]}`,
    `Budget: ${params[1]}`,
    `Job type: ${params[2]}`,
    `Payment verified: ${params[3]}`,
    `Matched skills: ${params[4]}`,
    `AI match score: ${params[5]}`,
    `Reason: ${params[6]}`,
    ...(input.riskFlags.length > 0 ? [`Risks: ${params[7]}`] : []),
    `Job URL: ${params[8]}`,
    ...(input.dashboardUrl ? [`Details: ${input.dashboardUrl}`] : []),
  ];
  return { templateParams: params, previewText: lines.join("\n") };
}

export interface RunSummaryInput {
  status: string;
  discovered: number;
  qualified: number;
  rejected: number;
  notified: number;
  failedNotifications: number;
  runUrl: string;
}

export function buildRunSummaryMessage(input: RunSummaryInput) {
  const params = [
    templateParam(input.status, 30),
    String(input.discovered),
    String(input.qualified),
    String(input.rejected),
    String(input.notified),
    String(input.failedNotifications),
    templateParam(input.runUrl, 500),
  ];
  const previewText = [
    "LeadPilot run summary",
    `Status: ${params[0]}`,
    `Jobs discovered: ${params[1]}`,
    `Qualified: ${params[2]}`,
    `Rejected: ${params[3]}`,
    `Alerts sent: ${params[4]}`,
    `Delivery failures: ${params[5]}`,
    `Details: ${params[6]}`,
  ].join("\n");
  return { templateParams: params, previewText };
}
