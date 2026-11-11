import { formatMoney } from "@/lib/money/decimal";
import type { RiskFlag } from "@/modules/ai/output-schema";

export interface LeadMessageInput {
  title: string;
  budgetAmount: string | null;
  budgetMax: string | null;
  /** Hourly jobs: the posted rate range. */
  hourlyMin?: string | null;
  hourlyMax?: string | null;
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

/** Fixed budget or range; for hourly jobs the posted rate ("USD 15 - USD 30 /hr", "USD 15+ /hr"). */
function budgetText(input: LeadMessageInput): string {
  const money = (value: string | null | undefined) => formatMoney(value ?? null, input.currency);
  if (input.budgetType === "HOURLY" && input.hourlyMin) {
    const range =
      input.hourlyMax && input.hourlyMax !== input.hourlyMin
        ? `${money(input.hourlyMin)} - ${money(input.hourlyMax)}`
        : `${money(input.hourlyMin)}${input.hourlyMax ? "" : "+"}`;
    return `${range} /hr`;
  }
  return input.budgetMax && input.budgetMax !== input.budgetAmount
    ? `${money(input.budgetAmount)} - ${money(input.budgetMax)}`
    : money(input.budgetAmount);
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
  const budget = budgetText(input);
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

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}
/** Only http(s) links become clickable; anything else is shown as text. */
function safeHref(url: string): string | null {
  return /^https?:\/\//i.test(url) ? escapeHtml(url) : null;
}

/**
 * E-mail version of the lead alert: the same fields and limits as the WhatsApp template, as plain text
 * plus a small HTML body. Every job-supplied value is escaped; job text is never treated as markup.
 */
export function buildLeadEmail(input: LeadMessageInput, format: "STANDARD" | "COMPACT") {
  const { templateParams: p, previewText } = buildLeadMessage(input, format);
  const subject = templateParam(`New lead (${p[5]}): ${input.title}`, 150);
  const rows: Array<[string, string]> = [
    ["Budget", p[1]!],
    ["Job type", p[2]!],
    ["Payment verified", p[3]!],
    ["Matched skills", p[4]!],
    ["AI match score", p[5]!],
    ["Reason", p[6]!],
    ...(input.riskFlags.length > 0 ? ([["Risks", p[7]!]] as Array<[string, string]>) : []),
  ];
  const jobLink = safeHref(p[8]!);
  const detailsLink = input.dashboardUrl ? safeHref(input.dashboardUrl) : null;
  const html = [
    `<h2 style="font-family:sans-serif">${escapeHtml(p[0]!)}</h2>`,
    `<table style="font-family:sans-serif;border-collapse:collapse">`,
    ...rows.map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#555">${escapeHtml(label)}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`,
    ),
    `</table>`,
    `<p style="font-family:sans-serif">`,
    jobLink ? `<a href="${jobLink}">Open the job on Upwork</a>` : escapeHtml(p[8]!),
    detailsLink ? ` · <a href="${detailsLink}">Details in LeadPilot</a>` : "",
    `</p>`,
  ].join("\n");
  return { subject, text: previewText, html };
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
