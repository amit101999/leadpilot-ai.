"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface DailyCostPoint {
  day: string; // YYYY-MM-DD (UTC)
  calls: number;
  tokens: number;
  /** Display only (bar height); exact amounts are in costLabel. */
  costUsd: number;
  costLabel: string;
}

const DAY = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" });
const dayLabel = (day: string) => DAY.format(new Date(`${day}T00:00:00Z`));
const count = (n: number) => new Intl.NumberFormat("en").format(n);

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: DailyCostPoint }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-control border border-line bg-surface px-3 py-2 text-[13px] shadow-sm">
      <p className="font-medium">{dayLabel(point.day)} (UTC)</p>
      <p className="tabular text-muted">
        Estimated cost: <span className="text-ink">{point.costLabel}</span>
      </p>
      <p className="tabular text-muted">
        Calls: <span className="text-ink">{count(point.calls)}</span>
      </p>
      <p className="tabular text-muted">
        Tokens: <span className="text-ink">{count(point.tokens)}</span>
      </p>
    </div>
  );
}

/** Estimated AI spend per UTC day. Calls and tokens are in the tooltip and the table. */
export function DailyCostChart({ data }: { data: DailyCostPoint[] }) {
  const empty = data.every((d) => d.calls === 0);
  return (
    <div>
      <div className="h-56" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barCategoryGap="20%" margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis
              dataKey="day"
              tickFormatter={dayLabel}
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(v: number) => `$${v < 1 ? v.toFixed(2) : v.toFixed(0)}`}
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--surface-sunken)" }} />
            <Bar
              dataKey="costUsd"
              name="Estimated cost"
              fill="var(--series-1)"
              radius={[4, 4, 0, 0]}
              maxBarSize={14}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {empty && <p className="mt-2 text-[13px] text-muted">No AI calls in this period yet.</p>}
      <details className="mt-3 text-[13px]">
        <summary className="cursor-pointer text-muted hover:text-ink">Show data as a table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="tabular w-full text-left">
            <caption className="sr-only">AI calls, tokens and estimated cost per day (UTC)</caption>
            <thead className="text-muted">
              <tr>
                <th scope="col" className="py-1 pr-4 font-medium">
                  Day (UTC)
                </th>
                <th scope="col" className="py-1 pr-4 font-medium">
                  Calls
                </th>
                <th scope="col" className="py-1 pr-4 font-medium">
                  Tokens
                </th>
                <th scope="col" className="py-1 font-medium">
                  Estimated cost
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.day} className="border-t border-line">
                  <td className="py-1 pr-4">{d.day}</td>
                  <td className="py-1 pr-4">{count(d.calls)}</td>
                  <td className="py-1 pr-4">{count(d.tokens)}</td>
                  <td className="py-1">{d.costLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
