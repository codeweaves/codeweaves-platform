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
  Mic,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useProfile } from '@/hooks/use-profile';
import { usePageHeader } from '@/components/layout/page-header';
import {
  useAgentAnalytics,
  useAnalyticsSummary,
  useConversationChannels,
  useConversationsChart,
  useVoiceSummary,
  type AnalyticsSummaryResponse,
} from '@/hooks/use-analytics';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BreakdownBars, type BreakdownItem } from '@/components/features/analytics/breakdown-bars';
import { cn } from '@/lib/utils';

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

/* ── range control ────────────────────────────────────────────────────── */

const RANGES = [7, 30, 90] as const;
type RangeDays = (typeof RANGES)[number];

function RangeToggle({
  value,
  onChange,
}: {
  value: RangeDays;
  onChange: (v: RangeDays) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5">
      {RANGES.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          aria-pressed={value === d}
          className={cn(
            'cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium tabular-nums transition-colors',
            value === d
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {d}D
        </button>
      ))}
    </div>
  );
}

/* ── trend text ───────────────────────────────────────────────────────── */

function TrendText({
  value,
  positiveIsGood = true,
}: {
  value?: number;
  positiveIsGood?: boolean;
}) {
  if (value === undefined || !Number.isFinite(value) || value === 0) {
    return <span className="text-xs font-medium text-muted-foreground">0%</span>;
  }
  const isUp = value > 0;
  const isGood = isUp === positiveIsGood;
  const Icon = isUp ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium tabular-nums',
        isGood ? 'text-success-foreground' : 'text-error-foreground',
      )}
    >
      <Icon className="size-3.5" />
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

/* ── KPI config ───────────────────────────────────────────────────────── */

type KpiKey = keyof AnalyticsSummaryResponse['kpis'];

const KPIS: Array<{
  key: string;
  label: string;
  icon: typeof MessageSquare;
  kind: 'count' | 'duration';
  source: 'summary' | 'voice';
  positiveIsGood?: boolean;
}> = [
  { key: 'totalMessagesExchanged', label: 'Messages', icon: MessagesSquare, kind: 'count', source: 'summary' },
  { key: 'totalUsers', label: 'Unique users', icon: Users, kind: 'count', source: 'summary' },
  { key: 'totalVoiceMessages', label: 'Voice messages', icon: Mic, kind: 'count', source: 'voice' },
  { key: 'avgResponseTimeMs', label: 'Avg response', icon: Gauge, kind: 'duration', source: 'summary', positiveIsGood: false },
];

/* ── channel labels ───────────────────────────────────────────────────── */

const CHANNEL_LABELS: Record<string, string> = {
  WIDGET: 'Website widget',
  WHATSAPP: 'WhatsApp',
  DEMO: 'Demo',
  VOICE: 'Voice',
};

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
  const [rangeDays, setRangeDays] = React.useState<RangeDays>(30);

  React.useEffect(() => {
    setTitle('Dashboard');
    return () => setTitle('');
  }, [setTitle]);

  // Window recomputed whenever the range changes; locked otherwise so query
  // keys stay stable across renders.
  const params = React.useMemo(() => {
    const now = new Date();
    return {
      startDate: formatDateLocal(subDays(now, rangeDays - 1)),
      endDate: formatDateLocal(now),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    };
  }, [rangeDays]);

  const summaryQuery = useAnalyticsSummary(params);
  const chartQuery = useConversationsChart(params);
  const channelsQuery = useConversationChannels(params);
  const voiceQuery = useVoiceSummary(params);
  const agentsQuery = useAgentAnalytics({
    ...params,
    page: 1,
    limit: 5,
    sortBy: 'conversations',
    sortOrder: 'desc',
  });

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
  const totalConversations = chartData.reduce((acc, d) => acc + d.count, 0);
  const conversationsTrend = summaryQuery.data?.kpis?.totalConversations?.trend;

  const channelItems: BreakdownItem[] = (channelsQuery.data?.channels ?? []).map((c) => ({
    label: CHANNEL_LABELS[c.source] ?? c.source,
    count: c.count,
    percentage: c.percentage,
  }));

  const agentRows = agentsQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome back, {firstName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&apos;s how your agents have performed over the last {rangeDays} days.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RangeToggle value={rangeDays} onChange={setRangeDays} />
          <Button asChild variant="outline">
            <Link href="/dashboard/analytics">
              <BarChart3 className="size-4" />
              Analytics
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI row — table-like grid: a muted header band per metric, a hairline
          divider, then the value. */}
      <Card className="gap-0 overflow-hidden p-0">
        <div className="grid grid-cols-4 divide-x divide-border">
          {KPIS.map((k) => {
            const kpi =
              k.source === 'voice'
                ? {
                    value: voiceQuery.data?.totalVoiceMessages,
                    trend: voiceQuery.data?.trend?.voiceMessagesTrend,
                  }
                : summaryQuery.data?.kpis?.[k.key as KpiKey];
            const cardLoading =
              k.source === 'voice' ? voiceQuery.isLoading : summaryQuery.isLoading;
            const value =
              k.kind === 'duration'
                ? formatDuration(kpi?.value ?? undefined)
                : formatCount(kpi?.value ?? undefined);
            return (
              <div key={k.key} className="flex flex-col">
                {/* Header band — dark label, muted icon (matches the reference) */}
                <div className="flex items-center gap-2 border-b border-border px-5 py-3">
                  <k.icon className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">{k.label}</span>
                </div>
                {/* Value */}
                <div className="flex items-end justify-between gap-3 px-5 py-4">
                  <div>
                    {cardLoading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <div className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                        {value}
                      </div>
                    )}
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <TrendText value={kpi?.trend ?? undefined} positiveIsGood={k.positiveIsGood} />
                      <span className="text-xs text-muted-foreground">
                        vs previous {rangeDays}d
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Main row: conversations chart + channel breakdown */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="col-span-2 gap-0 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Conversations</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Daily volume · last {rangeDays} days
              </p>
              <div className="mt-4 flex items-baseline gap-2.5">
                <span className="text-2xl font-semibold tabular-nums">
                  {formatCount(totalConversations)}
                </span>
                <TrendText value={conversationsTrend ?? undefined} />
              </div>
            </div>
            <Link
              href="/dashboard/analytics"
              className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline"
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
                <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="conv-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
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
                    stroke="var(--primary)"
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

        <Card className="col-span-1 gap-0 p-6">
          <h2 className="text-base font-semibold tracking-tight">Channels</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Where conversations come from
          </p>
          <div className="mt-6">
            {channelsQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full rounded-md" />
                ))}
              </div>
            ) : channelItems.length > 0 ? (
              <BreakdownBars items={channelItems} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No conversations in this range yet.
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* Top agents */}
      <Card className="gap-0 p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Top agents</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Busiest agents this period, by conversations
            </p>
          </div>
          <Link
            href="/dashboard/analytics"
            className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            View all
            <ArrowUpRight className="size-4" />
          </Link>
        </div>

        <div className="mt-4">
          {agentsQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : agentRows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Conversations</TableHead>
                  <TableHead className="text-right">Messages</TableHead>
                  <TableHead className="text-right">Avg response</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agentRows.map((row) => (
                  <TableRow key={row.agentId}>
                    <TableCell className="font-medium">{row.agentName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCount(row.conversations)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCount(row.messages)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatDuration(row.avgResponseTimeMs)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No agent activity in this range yet.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
