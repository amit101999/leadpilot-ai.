import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/ui/format";
import type { ProfileConfig } from "@/modules/profiles/config-schema";

const POLICY: Record<string, string> = {
  FAIL: "reject the job",
  NEEDS_REVIEW: "send it to review",
  IGNORE: "ignore the condition",
};

function Terms({ items, empty = "None" }: { items: string[]; empty?: string }) {
  if (items.length === 0) return <>{empty}</>;
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {items.map((item) => (
        <Badge key={item}>{item}</Badge>
      ))}
    </span>
  );
}

/**
 * Plain-language description of a profile configuration. `detailed` lists every
 * rule (used for a run's frozen snapshot); the short form shows the headline rules.
 */
export function ProfileSummary({ config, detailed = false }: { config: ProfileConfig; detailed?: boolean }) {
  const { budget, client, skills, ai, notifications, general } = config;
  const jobType = { FIXED: "Fixed-price only", HOURLY: "Hourly only", BOTH: "Fixed-price and hourly" }[
    budget.jobType
  ];
  const matchMode = {
    ANY: "at least one of",
    ALL: "all of",
    AT_LEAST: `at least ${skills.minRequiredMatches} of`,
  }[skills.requiredMatchMode];

  const rows: Array<[string, ReactNode]> = [
    ["Job type", jobType],
    [
      "Minimum budget",
      budget.fixedMin ? `${formatMoney(budget.fixedMin, budget.currency)} (fixed-price)` : "No minimum",
    ],
    ["Payment verification", client.paymentVerificationRequired ? "Required" : "Not required"],
    ["Minimum AI score", `${ai.minScore}/100`],
    [
      "Required skills",
      skills.required.length ? (
        <span>
          Must mention {matchMode}: <Terms items={skills.required.map((s) => s.name)} />
        </span>
      ) : (
        "None"
      ),
    ],
    [
      "E-mail alerts",
      notifications.emailEnabled ? `On, up to ${notifications.maxPerRun} per run` : "Off for this profile",
    ],
  ];

  if (detailed) {
    rows.push(
      ["Maximum budget", budget.fixedMax ? formatMoney(budget.fixedMax, budget.currency) : "No maximum"],
      ["Minimum hourly rate", budget.hourlyMin ? formatMoney(budget.hourlyMin, budget.currency) : "None"],
      [
        "Other currencies",
        budget.currencyPolicy.mode === "SAME_CURRENCY_ONLY"
          ? `Only ${budget.currency} budgets are compared; others count as unknown`
          : `Converted with fixed rates: ${Object.entries(budget.currencyPolicy.rates)
              .map(([code, rate]) => `1 ${code} = ${rate} ${budget.currency}`)
              .join(", ")}`,
      ],
      ["Budget ranges", "The lower bound is used"],
      ["Missing budget", `When the budget is unknown, ${POLICY[budget.missingBudgetPolicy]}`],
      ["Minimum client rating", client.minRating ?? "None"],
      ["Minimum client hires", client.minHires ?? "None"],
      [
        "Minimum client spend",
        client.minTotalSpent ? formatMoney(client.minTotalSpent, budget.currency) : "None",
      ],
      ["Allowed client countries", <Terms key="allowed" items={client.allowedCountries} empty="Any" />],
      ["Blocked client countries", <Terms key="blocked" items={client.blockedCountries} />],
      [
        "Unknown client data",
        `When a client condition cannot be checked, ${POLICY[client.unknownClientDataPolicy]}`,
      ],
      ["Optional skills", <Terms key="optional" items={skills.optional.map((s) => s.name)} />],
      ["Include keywords", <Terms key="include" items={skills.includeKeywords} />],
      ["Exclude keywords", <Terms key="exclude" items={skills.excludeKeywords} />],
      [
        "Required combinations",
        skills.requiredCombinations.length
          ? skills.requiredCombinations.map((combo) => combo.join(" + ")).join("; ")
          : "None",
      ],
      ["Category", skills.category ?? "Any"],
      [
        "AI score weights",
        `Skills ${ai.weights.skillAlignment}%, scope ${ai.weights.scopeFit}%, clarity ${ai.weights.descriptionClarity}%, client ${ai.weights.clientCredibility}%, relevance ${ai.weights.overallRelevance}%`,
      ],
      ["Risk sensitivity", ai.riskSensitivity.charAt(0) + ai.riskSensitivity.slice(1).toLowerCase()],
      ["Disqualifying risk flags", <Terms key="flags" items={ai.disqualifyingRiskFlags} />],
      ["AI retries on invalid output", ai.maxRetries],
      ["Jobs evaluated per run", general.maxJobsToEvaluate ?? "No limit"],
      ["Run summary message", notifications.sendRunSummary ? "Sent after every run" : "Off"],
      ["Failure alert", notifications.alertOnFailure ? "Sent when a run fails or has errors" : "Off"],
    );
  }

  return (
    <dl className="grid gap-x-8 gap-y-3 px-4 py-4 text-sm sm:grid-cols-[220px_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
