'use client';

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, Radio } from 'lucide-react';
import { formatNumber } from '@/lib/format-utils';
import type { ConversationChannelsResponse } from '@/hooks/use-analytics';

interface ChannelSplitChartProps {
  data?: ConversationChannelsResponse;
  isLoading: boolean;
  isError?: boolean;
  className?: string;
}

const CHANNEL_LABELS: Record<string, string> = {
  WIDGET: 'Widget',
  WHATSAPP: 'WhatsApp',
  DEMO: 'Demo',
};

// Stable color per channel so the donut and legend never reassign colors when
// one channel drops to zero and disappears from the response.
const CHANNEL_COLORS: Record<string, string> = {
  WIDGET: 'var(--chart-1)',
  WHATSAPP: 'var(--chart-2)',
  DEMO: 'var(--chart-3)',
};

const FALLBACK_COLOR = 'var(--muted-foreground)';

interface TooltipPayloadItem {
  name: string;
  value: number;
  payload: { percentage: number };
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload?.length) return null;
  const item = payload[0]!;
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-sm shadow-md">
      <p className="font-medium">{item.name}</p>
      <p className="text-muted-foreground">
        {formatNumber(item.value)} ({item.payload.percentage.toFixed(1)}%)
      </p>
    </div>
  );
}

export function ChannelSplitChart({ data, isLoading, isError, className }: ChannelSplitChartProps) {
  const channels = data?.channels ?? [];
  const hasData = channels.length > 0;
  const total = channels.reduce((sum, c) => sum + c.count, 0);

  const chartData = channels.map((c) => ({
    name: CHANNEL_LABELS[c.source] ?? c.source,
    source: c.source,
    value: c.count,
    percentage: c.percentage,
  }));

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <Radio className="size-4 text-muted-foreground" />
          Channels
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-62 w-full" />
        ) : isError ? (
          <div className="flex h-62 items-center justify-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            Failed to load channel data
          </div>
        ) : !hasData ? (
          <div className="flex h-62 items-center justify-center text-sm text-muted-foreground">
            No channel data for this period
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-4">
            <div className="relative size-40 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius="60%"
                    outerRadius="92%"
                    paddingAngle={2}
                    stroke="none"
                  >
                    {chartData.map((entry) => (
                      <Cell key={entry.source} fill={CHANNEL_COLORS[entry.source] ?? FALLBACK_COLOR} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              {/* Center total */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold tabular-nums">{formatNumber(total)}</span>
                <span className="text-xs text-muted-foreground">conversations</span>
              </div>
            </div>

            {/* Legend with values */}
            <ul className="min-w-0 flex-1 space-y-2 text-sm">
              {chartData.map((entry) => (
                <li key={entry.source} className="flex items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: CHANNEL_COLORS[entry.source] ?? FALLBACK_COLOR }}
                  />
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatNumber(entry.value)}
                    <span className="ml-1.5 text-xs">({entry.percentage.toFixed(1)}%)</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
