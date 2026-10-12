import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

/** Native checkbox with a clickable label and optional hint. */
export function Checkbox({
  label,
  hint,
  className,
  ...props
}: Omit<ComponentProps<"input">, "type"> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5 text-sm", className)}>
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" {...props} />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-[13px] text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-20 w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted aria-[invalid=true]:border-danger",
        className,
      )}
      {...props}
    />
  );
}
