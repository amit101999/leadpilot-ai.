import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { formatCount } from "@/lib/ui/format";

export interface FunnelCounts {
  discovered: number;
  passedFilters: number;
  evaluated: number;
  qualified: number;
  notified: number;
}

const STEPS: Array<{ key: keyof FunnelCounts; label: string }> = [
  { key: "discovered", label: "Discovered" },
  { key: "passedFilters", label: "Passed rules" },
  { key: "evaluated", label: "AI evaluated" },
  { key: "qualified", label: "Qualified" },
  { key: "notified", label: "E-mailed" },
];

/**
 * How a run narrowed jobs down to leads: actual counts at each step, never
 * estimates. The share shown is relative to the previous step.
 */
export function FunnelRail({ counts, label = "Lead funnel" }: { counts: FunnelCounts; label?: string }) {
  return (
    <ol aria-label={label} className="flex flex-wrap items-stretch gap-y-3 sm:flex-nowrap">
      {STEPS.map((step, index) => {
        const value = counts[step.key];
        const previous = index > 0 ? counts[STEPS[index - 1]!.key] : null;
        const share = previous ? Math.round((value / previous) * 100) : null;
        const last = index === STEPS.length - 1;
        return (
          <Fragment key={step.key}>
            <li className="flex min-w-[45%] flex-1 flex-col sm:min-w-0">
              <span className="text-[13px] text-muted">{step.label}</span>
              <span className={`tabular text-2xl font-semibold ${last ? "text-accent" : ""}`}>
                {formatCount(value)}
              </span>
              <span className="tabular text-xs text-muted">
                {share === null ? "from the source" : `${share}% of previous step`}
              </span>
            </li>
            {!last && (
              <li aria-hidden className="hidden items-center px-2 text-line-strong sm:flex">
                <ChevronRight className="size-5" />
              </li>
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}
