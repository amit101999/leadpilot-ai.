"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface DailyPoint {
  day: string; // YYYY-MM-DD (UTC)
  runs: number;
  qualified: number;
  notified: number;
}

const SERIES = [
  { key: "qualified", label: "Qualified leads", color: "var(--series-1)" },
  { key: "notified", label: "Alerts sent", color: "var(--series-2)" },
] as const;

const DAY = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" });
const dayLabel = (day: string) => DAY.format(new Date(`${day}T00:00:00Z`));

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: DailyPoint }> }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-control border border-line bg-surface px-3 py-2 text-[13px] shadow-sm">
      <p className="font-medium">{dayLabel(point.day)} (UTC)</p>
      {SERIES.map((s) => (
        <p key={s.key} className="tabular flex items-center gap-2 text-muted">
          <span aria-hidden className="size-2 rounded-full" style={{ background: s.color }} />
          {s.label}: <span className="text-ink">{point[s.key]}</span>
        </p>
      ))}
      <p className="tabular text-muted">
        Runs: <span className="text-ink">{point.runs}</span>
      </p>
    </div>
  );
}

/**
 * Qualified leads and alerts sent per UTC day. Both are lead counts, so they
 * share one axis; runs per day (a different scale) is in the tooltip and table.
 */
export function DailyChart({ data }: { data: DailyPoint[] }) {
  const empty = data.every((d) => d.qualified === 0 && d.notified === 0);
  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-4 text-[13px] text-muted" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span aria-hidden className="size-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
      <div className="h-56" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            barGap={2}
            barCategoryGap="20%"
            margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
          >
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
              allowDecimals={false}
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--surface-sunken)" }} />
            {SERIES.map((s) => (
              // No load animation: decorative motion is out of scope for this tool, and data shows at once.
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={s.color}
                radius={[4, 4, 0, 0]}
                maxBarSize={14}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {empty && <p className="mt-2 text-[13px] text-muted">No leads in the last 30 days yet.</p>}
      <details className="mt-3 text-[13px]">
        <summary className="cursor-pointer text-muted hover:text-ink">Show data as a table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="tabular w-full text-left">
            <caption className="sr-only">Runs, qualified leads and alerts sent per day (UTC)</caption>
            <thead className="text-muted">
              <tr>
                <th scope="col" className="py-1 pr-4 font-medium">
                  Day (UTC)
                </th>
                <th scope="col" className="py-1 pr-4 font-medium">
                  Runs
                </th>
                <th scope="col" className="py-1 pr-4 font-medium">
                  Qualified leads
                </th>
                <th scope="col" className="py-1 font-medium">
                  Alerts sent
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.day} className="border-t border-line">
                  <td className="py-1 pr-4">{d.day}</td>
                  <td className="py-1 pr-4">{d.runs}</td>
                  <td className="py-1 pr-4">{d.qualified}</td>
                  <td className="py-1">{d.notified}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
