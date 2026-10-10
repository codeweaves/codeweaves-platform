"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CostCategory, UsageTimeseries } from "@/hooks/use-usage";
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  FEATURE_CATEGORY,
  formatInr,
} from "./usage-format";

const CATEGORIES: CostCategory[] = ["LLM", "STT", "TTS", "OTHER"];

type ChartPoint = { date: string } & Record<CostCategory, number>;

function formatDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

interface TooltipItem {
  dataKey: CostCategory;
  value: number;
  color: string;
}

function DailyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string;
}) {
  if (!active || !payload?.length || !label) return null;
  const total = payload.reduce((sum, p) => sum + (p.value ?? 0), 0);
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-sm shadow-md">
      <p className="font-medium">{formatDay(label)} (UTC)</p>
      {payload
        .filter((p) => p.value > 0)
        .map((p) => (
          <p
            key={p.dataKey}
            className="flex items-center gap-2 text-muted-foreground"
          >
            <span
              className="size-2 rounded-full"
              style={{ background: p.color }}
            />
            {CATEGORY_LABELS[p.dataKey]}: {formatInr(p.value)}
          </p>
        ))}
      <p className="mt-1 font-medium">Total: {formatInr(total)}</p>
    </div>
  );
}

/** Stacked daily INR cost by LLM / STT / TTS / other. Recharts lives only in this chunk. */
export default function UsageDailyChart({ data }: { data: UsageTimeseries }) {
  const points = useMemo<ChartPoint[]>(
    () =>
      data.days.map((day) => {
        const point: ChartPoint = {
          date: day.date,
          LLM: 0,
          STT: 0,
          TTS: 0,
          OTHER: 0,
        };
        for (const [feature, inr] of Object.entries(day.byFeature)) {
          point[FEATURE_CATEGORY[feature] ?? "OTHER"] += inr ?? 0;
        }
        return point;
      }),
    [data],
  );

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={points} margin={{ left: 8, right: 8 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-muted"
          vertical={false}
        />
        <XAxis
          dataKey="date"
          tickFormatter={formatDay}
          className="text-xs"
          tick={{ fill: "var(--muted-foreground)" }}
          minTickGap={16}
        />
        <YAxis
          className="text-xs"
          tick={{ fill: "var(--muted-foreground)" }}
          tickFormatter={(v: number) => `₹${v.toLocaleString("en-IN")}`}
          width={72}
        />
        <Tooltip
          content={<DailyTooltip />}
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
        />
        <Legend formatter={(value: CostCategory) => CATEGORY_LABELS[value]} />
        {CATEGORIES.map((c) => (
          <Bar
            key={c}
            dataKey={c}
            stackId="cost"
            fill={CATEGORY_COLORS[c]}
            maxBarSize={36}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
