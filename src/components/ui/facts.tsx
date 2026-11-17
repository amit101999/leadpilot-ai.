import type { ReactNode } from "react";

/** A label/value list for detail pages. */
export function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid gap-x-8 gap-y-2.5 px-4 py-4 text-sm sm:grid-cols-[200px_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "Unknown" for a value the source did not supply, never a misleading 0 or blank. */
export function known(value: string | number | null | undefined, suffix = ""): string {
  return value === null || value === undefined ? "Unknown" : `${value}${suffix}`;
}
