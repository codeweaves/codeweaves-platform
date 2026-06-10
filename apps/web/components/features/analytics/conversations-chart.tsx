'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle } from 'lucide-react';
import type { ConversationsChartResponse } from '@/hooks/use-analytics';

interface ConversationsChartProps {
  data?: ConversationsChartResponse;
  isLoading: boolean;
  isError?: boolean;
  className?: string;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface TooltipPayloadItem {
  value: number;
  payload: { date: string; count: number };
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
  const d = new Date(item.payload.date + 'T00:00:00');
  const formatted = d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-sm shadow-md">
      <p className="font-medium">{formatted}</p>
      <p className="text-muted-foreground">
        {item.value.toLocaleString()} conversations
      </p>
    </div>
  );
}

export function ConversationsChart({ data, isLoading, isError, className }: ConversationsChartProps) {
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-base font-medium">Conversations Over Time</CardTitle>
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
          <CardTitle className="text-base font-medium">Conversations Over Time</CardTitle>
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

  const hasData = data?.data && data.data.length > 0;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base font-medium">Conversations Over Time</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-75 items-center justify-center text-muted-foreground">
            No data for this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data.data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDateLabel}
                className="text-xs"
                tick={{ fill: 'var(--muted-foreground)' }}
              />
              <YAxis
                className="text-xs"
                tick={{ fill: 'var(--muted-foreground)' }}
                allowDecimals={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="count"
                stroke="var(--primary)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
