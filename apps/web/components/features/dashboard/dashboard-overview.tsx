'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts';
import {
  ArrowUpRight,
  BarChart3,
  Gauge,
  MessageSquare,
  MessagesSquare,
  Users,
} from 'lucide-react';
import { useProfile } from '@/hooks/use-profile';
import { usePageHeader } from '@/components/layout/page-header';
import {
  useAnalyticsSummary,
  useConversationsChart,
  type AnalyticsSummaryResponse,
} from '@/hooks/use-analytics';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard, StatCardSkeleton } from './stat-card';

/* ── date / value helpers ─────────────────────────────────────────────── */

function pad(n: number) {
  return String(n).padStart(2, '0');
}
function formatDateLocal(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function subDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() - days);
  return x;
}
function formatCount(n: number | undefined) {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString();
}
function formatDuration(ms: number | undefined) {
  if (ms === undefined || ms === null || Number.isNaN(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

/* ── KPI config ───────────────────────────────────────────────────────── */

type KpiKey = keyof AnalyticsSummaryResponse['kpis'];

const KPIS: Array<{
  key: KpiKey;
  label: string;
  icon: typeof MessageSquare;
  kind: 'count' | 'duration';
  positiveIsGood?: boolean;
}> = [
  { key: 'totalConversations', label: 'Conversations', icon: MessageSquare, kind: 'count' },
  { key: 'totalMessagesExchanged', label: 'Messages', icon: MessagesSquare, kind: 'count' },
  { key: 'totalUsers', label: 'Unique users', icon: Users, kind: 'count' },
  { key: 'avgResponseTimeMs', label: 'Avg response', icon: Gauge, kind: 'duration', positiveIsGood: false },
];

/* ── chart tooltip ────────────────────────────────────────────────────── */

interface ChartTooltipItem {
  value: number;
  payload: { date: string; label: string; count: number };
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ChartTooltipItem[];
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0]!;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md">
      <p className="text-xs text-muted-foreground">{item.payload.label}</p>
      <p className="text-sm font-semibold tabular-nums">
        {item.value.toLocaleString()} conversations
      </p>
    </div>
  );
}

/* ── main ─────────────────────────────────────────────────────────────── */

export function DashboardOverview() {
  const { profile } = useProfile();
  const { setTitle } = usePageHeader();

  React.useEffect(() => {
    setTitle('Dashboard');
    return () => setTitle('');
  }, [setTitle]);

  // 30-day window, locked at mount so the query key stays stable across renders.
  const params = React.useMemo(() => {
    const now = new Date();
    return {
      startDate: formatDateLocal(subDays(now, 29)),
      endDate: formatDateLocal(now),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    };
  }, []);

  const summaryQuery = useAnalyticsSummary(params);
  const chartQuery = useConversationsChart(params);

  const firstName = (profile?.name?.trim() || profile?.email || 'there').split(' ')[0];

  const chartData = React.useMemo(
    () =>
      (chartQuery.data?.data ?? []).map((p) => ({
        date: p.date,
        label: new Date(p.date + 'T00:00:00').toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        }),
        count: p.count,
      })),
    [chartQuery.data],
  );

  const hasChartData = chartData.some((d) => d.count > 0);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome back, {firstName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&apos;s how your agents have performed over the last 30 days.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/analytics">
            <BarChart3 className="size-4" />
            Open analytics
          </Link>
        </Button>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-4 gap-4">
        {summaryQuery.isLoading
          ? KPIS.map((k) => <StatCardSkeleton key={k.key} />)
          : KPIS.map((k) => {
              const kpi = summaryQuery.data?.kpis?.[k.key];
              const value =
                k.kind === 'duration'
                  ? formatDuration(kpi?.value ?? undefined)
                  : formatCount(kpi?.value ?? undefined);
              return (
                <StatCard
                  key={k.key}
                  label={k.label}
                  value={value}
                  icon={k.icon}
                  trend={kpi?.trend ?? undefined}
                  positiveIsGood={k.positiveIsGood}
                  hint="vs previous 30 days"
                />
              );
            })}
      </div>

      {/* Conversations area chart */}
      <Card className="gap-0 p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              Conversations
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Daily volume · last 30 days
            </p>
          </div>
          <Link
            href="/dashboard/analytics"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            Details
            <ArrowUpRight className="size-4" />
          </Link>
        </div>

        <div className="mt-6 h-64 w-full">
          {chartQuery.isLoading ? (
            <Skeleton className="h-full w-full rounded-lg" />
          ) : hasChartData ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id="conv-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                  dy={8}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ stroke: 'var(--primary)', strokeOpacity: 0.3 }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  fill="url(#conv-fill)"
                  activeDot={{ r: 4, strokeWidth: 0 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
              <MessageSquare className="size-7 text-muted-foreground/50" />
              <p className="text-sm font-medium">No conversations yet</p>
              <p className="text-xs text-muted-foreground">
                Once your agents start chatting, daily volume shows up here.
              </p>
            </div>
          )}
        </div>
      </Card>

    </div>
  );
}
