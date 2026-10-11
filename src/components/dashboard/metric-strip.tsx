import { formatCount } from "@/lib/ui/format";
import { cn } from "@/lib/ui/cn";

export interface Metric {
  label: string;
  value: number;
  /** Optional emphasis for counts that need attention (failures). */
  tone?: "default" | "danger";
  hint?: string;
}

/** One bordered strip with dividers, not a grid of separate cards. */
export function MetricStrip({ metrics, label }: { metrics: Metric[]; label: string }) {
  return (
    <dl
      aria-label={label}
      className="grid grid-cols-2 overflow-hidden rounded-panel border border-line bg-surface sm:grid-cols-4 xl:grid-cols-8"
    >
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="-mt-px -ml-px border-t border-l border-line px-4 py-3"
          title={metric.hint}
        >
          <dt className="text-[13px] text-muted">{metric.label}</dt>
          <dd
            className={cn(
              "tabular mt-1 text-xl font-semibold",
              metric.tone === "danger" && metric.value > 0 && "text-danger",
            )}
          >
            {formatCount(metric.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
