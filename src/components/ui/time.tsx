"use client";

import { toDate } from "@/lib/ui/format";

const FORMAT = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Shows a timestamp in the viewer's local time zone. The server render may use
 * a different zone, so the text is allowed to differ during hydration.
 */
export function Time({
  value,
  fallback = "–",
}: {
  value: Date | string | null | undefined;
  fallback?: string;
}) {
  const date = toDate(value);
  if (!date) return <>{fallback}</>;
  return (
    <time dateTime={date.toISOString()} title={date.toISOString()} suppressHydrationWarning>
      {FORMAT.format(date)}
    </time>
  );
}
