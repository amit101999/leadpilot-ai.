import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/ui/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-info-soft text-muted",
        accent: "bg-accent-soft text-accent",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        danger: "bg-danger-soft text-danger",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export function Badge({
  className,
  tone,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** One mapping from every domain status to a tone and a readable label. */
const STATUS: Record<string, { tone: BadgeTone; label: string }> = {
  // runs
  QUEUED: { tone: "neutral", label: "Queued" },
  RUNNING: { tone: "accent", label: "Running" },
  COMPLETED: { tone: "success", label: "Completed" },
  COMPLETED_WITH_ERRORS: { tone: "warning", label: "Completed with errors" },
  FAILED: { tone: "danger", label: "Failed" },
  CANCELLED: { tone: "neutral", label: "Cancelled" },
  BLOCKED_SOURCE: { tone: "danger", label: "Source blocked" },
  // jobs and decisions
  NEW: { tone: "neutral", label: "New" },
  FILTERED_OUT: { tone: "danger", label: "Filtered out" },
  PENDING_AI: { tone: "neutral", label: "Pending AI" },
  QUALIFIED: { tone: "success", label: "Qualified" },
  REJECTED: { tone: "danger", label: "Rejected" },
  NEEDS_REVIEW: { tone: "warning", label: "Needs review" },
  AI_ERROR: { tone: "danger", label: "AI error" },
  SOURCE_ERROR: { tone: "danger", label: "Source error" },
  // notifications
  RESERVED: { tone: "neutral", label: "Reserved" },
  SENDING: { tone: "accent", label: "Sending" },
  SENT: { tone: "success", label: "Sent" },
  DELIVERED: { tone: "success", label: "Delivered" },
  READ: { tone: "success", label: "Read" },
  FAILED_RETRYABLE: { tone: "warning", label: "Failed, will retry" },
  FAILED_PERMANENT: { tone: "danger", label: "Failed" },
  UNCERTAIN: { tone: "warning", label: "Delivery unknown" },
  // stages and integrations
  PENDING: { tone: "neutral", label: "Pending" },
  SKIPPED: { tone: "neutral", label: "Skipped" },
  CONNECTED: { tone: "success", label: "Connected" },
  CONFIGURED: { tone: "accent", label: "Configured" },
  NOT_CONFIGURED: { tone: "neutral", label: "Not configured" },
  NOT_AUTHORIZED: { tone: "danger", label: "Not authorized" },
  UNAVAILABLE: { tone: "danger", label: "Unavailable" },
  MOCK: { tone: "warning", label: "Mock" },
};

export function statusLabel(status: string): string {
  return STATUS[status]?.label ?? status;
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const entry = STATUS[status] ?? { tone: "neutral" as const, label: status };
  return (
    <Badge tone={entry.tone} className={className}>
      {entry.label}
    </Badge>
  );
}
