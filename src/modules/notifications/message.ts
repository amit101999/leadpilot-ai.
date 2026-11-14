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

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
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

/** One line of at most `max` characters: job text cannot add line breaks (e.g. to an e-mail subject). */
export function oneLine(text: string, max = 200): string {
  const clean = text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  return (clean.length > max ? `${clean.slice(0, max - 1)}…` : clean) || "-";
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

function htmlTable(rows: Array<[string, string]>): string[] {
  return [
    `<table style="font-family:sans-serif;border-collapse:collapse">`,
    ...rows.map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#555">${escapeHtml(label)}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`,
    ),
    `</table>`,
  ];
}

/**
 * Lead alert e-mail: plain text (also stored as the notification preview) plus a small HTML body.
 * Every job-supplied value is shortened to one line and escaped; job text is never treated as markup.
 */
export function buildLeadEmail(input: LeadMessageInput, format: "STANDARD" | "COMPACT"): EmailContent {
  const title = oneLine(input.title);
  const score = oneLine(`${input.score}/100`, 10);
  const jobUrl = oneLine(input.jobUrl, 500);
  const jobType =
    input.budgetType === "FIXED" ? "Fixed price" : input.budgetType === "HOURLY" ? "Hourly" : "Unknown";
  const verified =
    input.paymentVerified === true ? "Yes" : input.paymentVerified === false ? "No" : "Unknown";
  const rows: Array<[string, string]> = [
    ["Budget", oneLine(budgetText(input), 60)],
    ["Job type", jobType],
    ["Payment verified", verified],
    ["Matched skills", oneLine(input.skills.length > 0 ? input.skills.join(", ") : "-")],
    ["AI match score", score],
    ["Reason", oneLine(format === "COMPACT" ? input.reason.slice(0, 80) : input.reason, 300)],
  ];
  if (input.riskFlags.length > 0) {
    rows.push(["Risks", oneLine(input.riskFlags.map((r) => `${r.code} (${r.severity})`).join(", "))]);
  }

  const text = [
    "New qualified Upwork lead",
    "",
    `Job title: ${title}`,
    ...rows.map(([label, value]) => `${label}: ${value}`),
    `Job URL: ${jobUrl}`,
    ...(input.dashboardUrl ? [`Details: ${input.dashboardUrl}`] : []),
  ].join("\n");

  const jobLink = safeHref(jobUrl);
  const detailsLink = input.dashboardUrl ? safeHref(input.dashboardUrl) : null;
  const html = [
    `<h2 style="font-family:sans-serif">${escapeHtml(title)}</h2>`,
    ...htmlTable(rows),
    `<p style="font-family:sans-serif">`,
    jobLink ? `<a href="${jobLink}">Open the job on Upwork</a>` : escapeHtml(jobUrl),
    detailsLink ? ` · <a href="${detailsLink}">Details in LeadPilot</a>` : "",
    `</p>`,
  ].join("\n");

  return { subject: oneLine(`New lead (${score}): ${input.title}`, 150), text, html };
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

/** Run summary / failure alert e-mail. */
export function buildRunSummaryEmail(input: RunSummaryInput): EmailContent {
  const status = oneLine(input.status, 30);
  const runUrl = oneLine(input.runUrl, 500);
  const rows: Array<[string, string]> = [
    ["Status", status],
    ["Jobs discovered", String(input.discovered)],
    ["Qualified", String(input.qualified)],
    ["Rejected", String(input.rejected)],
    ["Alerts sent", String(input.notified)],
    ["Delivery failures", String(input.failedNotifications)],
  ];
  const text = [
    "LeadPilot run summary",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    `Details: ${runUrl}`,
  ].join("\n");
  const link = safeHref(runUrl);
  const html = [
    `<h2 style="font-family:sans-serif">LeadPilot run summary</h2>`,
    ...htmlTable(rows),
    `<p style="font-family:sans-serif">${link ? `<a href="${link}">Open the run in LeadPilot</a>` : escapeHtml(runUrl)}</p>`,
  ].join("\n");
  return { subject: `LeadPilot run ${status}`, text, html };
}
