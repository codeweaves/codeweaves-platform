'use client';

import { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  LabelList,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle } from 'lucide-react';
import { formatDuration } from '@/lib/format-utils';
import type { ResponseTimesChartResponse, ResponseTimeBucket } from '@/hooks/use-analytics';

interface ResponseTimesChartProps {
  data?: ResponseTimesChartResponse;
  isLoading: boolean;
  isError?: boolean;
  className?: string;
}

const BUCKET_COLORS: Record<string, string> = {
  '<1s': '#22c55e',
  '1-2s': '#84cc16',
  '2-5s': '#eab308',
  '5-10s': '#f97316',
  '>10s': '#ef4444',
};

interface TooltipPayloadItem {
  payload: ResponseTimeBucket;
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}) {
  if (!active || !payload?.length) return null;
  const bucket = payload[0]!.payload;
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-sm shadow-md">
      <p className="font-medium">{bucket.label}</p>
      <p className="text-muted-foreground">
        {bucket.count.toLocaleString()} responses ({bucket.percentage.toFixed(1)}%)
      </p>
    </div>
  );
}

function formatPercentageLabel(value: string | number | boolean | null | undefined): string {
  if (value == null || value === '') return '';
  return `${Number(value).toFixed(1)}%`;
}

export function ResponseTimesChart({ data, isLoading, isError, className }: ResponseTimesChartProps) {
  const buckets = useMemo(() => data?.buckets ?? [], [data]);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-base font-medium">Response Time Distribution</CardTitle>
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
          <CardTitle className="text-base font-medium">Response Time Distribution</CardTitle>
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

  const hasData = buckets.length > 0 && buckets.some((b) => b.count > 0);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base font-medium">Response Time Distribution</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-75 items-center justify-center text-muted-foreground">
            No response time data for this period
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={buckets}>
                <XAxis
                  dataKey="label"
                  className="text-xs"
                  tick={{ fill: 'hsl(var(--muted-foreground))' }}
                />
                <YAxis
                  className="text-xs"
                  tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  allowDecimals={false}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {buckets.map((entry) => (
                    <Cell key={entry.label} fill={BUCKET_COLORS[entry.label] ?? '#6b7280'} />
                  ))}
                  <LabelList
                    dataKey="percentage"
                    position="top"
                    className="text-xs fill-muted-foreground"
                    formatter={formatPercentageLabel}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {data?.percentiles && (
              <div className="mt-4 flex items-center gap-4">
                <Badge variant="outline">P50: {formatDuration(data.percentiles.p50)}</Badge>
                <Badge variant="outline">P95: {formatDuration(data.percentiles.p95)}</Badge>
                <Badge variant="outline">P99: {formatDuration(data.percentiles.p99)}</Badge>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
