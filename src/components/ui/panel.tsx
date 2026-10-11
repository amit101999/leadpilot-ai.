import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

/** A bordered region of the page with an optional header row. */
export function Panel({
  title,
  description,
  actions,
  className,
  children,
  ...props
}: Omit<ComponentProps<"section">, "title"> & {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  const headingId = props.id ? `${props.id}-title` : undefined;
  return (
    <section
      aria-labelledby={headingId}
      // min-w-0 lets a panel inside a grid shrink, so wide tables scroll inside it instead of widening the page.
      className={cn("min-w-0 rounded-panel border border-line bg-surface", className)}
      {...props}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1 basis-48">
            {title && (
              <h2 id={headingId} className="text-sm font-semibold text-ink">
                {title}
              </h2>
            )}
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden className={cn("animate-pulse rounded-control bg-sunken", className)} {...props} />;
}

/** Empty state: says what is missing and what to do next. */
export function EmptyState({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 px-4 py-8">
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <p className="max-w-prose text-[13px] text-muted">{children}</p>}
      {action}
    </div>
  );
}
