'use client';

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle } from 'lucide-react';
import type { WeekdayConversationsResponse } from '@/hooks/use-analytics';

interface ConversationsByWeekdayChartProps {
  data?: WeekdayConversationsResponse;
  isLoading: boolean;
  isError?: boolean;
  className?: string;
}

const TITLE = 'Conversations by Day of Week';
// API day index: 0=Sun … 6=Sat
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

interface TooltipPayloadItem {
  value: number;
  payload: { label: string; count: number };
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0]!;
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-sm shadow-md">
      <p className="font-medium">{item.payload.label}</p>
      <p className="text-muted-foreground">
        {item.value.toLocaleString()} conversations
      </p>
    </div>
  );
}

export function ConversationsByWeekdayChart({
  data,
  isLoading,
  isError,
  className,
}: ConversationsByWeekdayChartProps) {
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-base font-medium">{TITLE}</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-75 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-base font-medium">{TITLE}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-75 items-center justify-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            Failed to load chart data
          </div>
        </CardContent>
      </Card>
    );
  }

  const chartData = (data?.data ?? []).map((d) => ({
    label: DAY_LABELS[d.day] ?? String(d.day),
    count: d.count,
  }));
  const maxCount = Math.max(0, ...chartData.map((d) => d.count));
  const hasData = maxCount > 0;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base font-medium">{TITLE}</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-75 items-center justify-center text-muted-foreground">
            No data for this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis
                dataKey="label"
                className="text-xs"
                tick={{ fill: 'var(--muted-foreground)' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                className="text-xs"
                tick={{ fill: 'var(--muted-foreground)' }}
                allowDecimals={false}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--muted)', opacity: 0.3 }} />
              {/* Busiest day stands out at full opacity; others dimmed. */}
              <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]}>
                {chartData.map((d) => (
                  <Cell
                    key={d.label}
                    fillOpacity={d.count === maxCount ? 1 : 0.45}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
