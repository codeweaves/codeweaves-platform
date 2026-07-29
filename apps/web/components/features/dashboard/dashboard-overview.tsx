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
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  ChevronRight,
  Clock,
  Gauge,
  Inbox,
  MessageSquare,
  Plus,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  UserPlus,
} from 'lucide-react';
import { useProfile } from '@/hooks/use-profile';
import { usePageHeader } from '@/components/layout/page-header';
import {
  useAgentAnalytics,
  useAnalyticsSummary,
  useConversationsChart,
  useHandoverAnalytics,
  useLeadsCaptured,
  type AnalyticsSummaryResponse,
} from '@/hooks/use-analytics';
import { useAgents, type Agent } from '@/hooks/use-agents';
import { useInbox, type InboxItem } from '@/hooks/use-handover';
import { useConversations, type ConversationListItem } from '@/hooks/use-conversations';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/* ── helpers ──────────────────────────────────────────────────────────── */

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
// The conversations API filters `createdAt <= new Date(to)`; a bare YYYY-MM-DD
// parses to midnight UTC and drops almost the whole end day. Match the
// convention used by the conversation list: expand to local start/end of day.
function toIsoStartOfDay(d: string) {
  return new Date(`${d}T00:00:00`).toISOString();
}
function toIsoEndOfDay(d: string) {
  return new Date(`${d}T23:59:59.999`).toISOString();
}
function formatCount(n: number | undefined | null) {
  if (n == null || Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString();
}
function formatDuration(ms: number | undefined | null) {
  if (ms == null || Number.isNaN(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}
function timeAgo(iso: string | null | undefined) {
  if (!iso) return '';
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const CHANNEL_LABELS: Record<string, string> = {
  WIDGET: 'Widget',
  WHATSAPP: 'WhatsApp',
  DEMO: 'Demo',
};

/* ── range control ────────────────────────────────────────────────────── */

const RANGES = [7, 30, 90] as const;
type RangeDays = (typeof RANGES)[number];

function RangeToggle({ value, onChange }: { value: RangeDays; onChange: (v: RangeDays) => void }) {
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
            value === d ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {d}D
        </button>
      ))}
    </div>
  );
}

/* ── trend text ───────────────────────────────────────────────────────── */

function TrendText({ value, positiveIsGood = true }: { value?: number | null; positiveIsGood?: boolean }) {
  if (value == null || !Number.isFinite(value) || value === 0) {
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

function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline"
    >
      {children}
      <ArrowUpRight className="size-4" />
    </Link>
  );
}

/* ── KPI config ───────────────────────────────────────────────────────── */

type KpiKey = keyof AnalyticsSummaryResponse['kpis'];

const KPIS: Array<{
  key: string;
  label: string;
  icon: typeof MessageSquare;
  kind: 'count' | 'duration' | 'rate';
  source: 'summary' | 'handover' | 'leads';
  positiveIsGood?: boolean;
}> = [
  { key: 'totalConversations', label: 'Conversations', icon: MessageSquare, kind: 'count', source: 'summary' },
  { key: 'totalLeads', label: 'Leads captured', icon: UserPlus, kind: 'count', source: 'leads' },
  { key: 'handoverRate', label: 'Handover rate', icon: ArrowLeftRight, kind: 'rate', source: 'handover', positiveIsGood: false },
  { key: 'avgResponseTimeMs', label: 'Avg response', icon: Gauge, kind: 'duration', source: 'summary', positiveIsGood: false },
];

/* ── chart tooltip ────────────────────────────────────────────────────── */

interface ChartTooltipItem {
  value: number;
  payload: { label: string };
}
function ChartTooltip({ active, payload }: { active?: boolean; payload?: ChartTooltipItem[] }) {
  if (!active || !payload?.length) return null;
  const item = payload[0]!;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md">
      <p className="text-xs text-muted-foreground">{item.payload.label}</p>
      <p className="text-sm font-semibold tabular-nums">{item.value.toLocaleString()} conversations</p>
    </div>
  );
}

/* ── Needs attention ──────────────────────────────────────────────────── */

function AttentionPanel({
  waiting,
  isLoading,
  isError,
}: {
  waiting: InboxItem[];
  isLoading: boolean;
  isError: boolean;
}) {
  const count = waiting.length;
  // listInbox orders REQUESTED first, oldest-waiting first — so [0] is the oldest.
  const oldest = waiting[0]?.handoverRequestedAt ?? null;
  // Never fall through to "all clear" when the inbox check failed — this panel's
  // whole job is flagging unresolved handovers, so a false negative is the worst case.
  const iconTone = isError
    ? 'bg-warning text-warning-foreground'
    : count > 0
      ? 'bg-error text-error-foreground'
      : 'bg-success text-success-foreground';

  return (
    <Card className="gap-0 p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className={cn('flex size-9 items-center justify-center rounded-lg', iconTone)}>
            {!isError && count === 0 ? (
              <ShieldCheck className="size-[1.15rem]" />
            ) : (
              <Inbox className="size-[1.15rem]" />
            )}
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-tight">Needs your attention</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {isLoading
                ? 'Checking the inbox…'
                : isError
                  ? "Couldn't check the inbox — open it to see what's waiting."
                  : count > 0
                    ? `${count} conversation${count === 1 ? '' : 's'} waiting for a human${oldest ? ` · oldest ${timeAgo(oldest)}` : ''}`
                    : 'All clear — no conversations are waiting for a human.'}
            </p>
          </div>
        </div>
        {(count > 0 || isError) && (
          <Button asChild size="sm" variant={isError ? 'outline' : 'default'}>
            <Link href="/dashboard/inbox">Open inbox</Link>
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : count > 0 ? (
        <div className="mt-4 divide-y divide-border rounded-lg border border-border">
          {waiting.slice(0, 3).map((item) => (
            <Link
              key={item.id}
              href="/dashboard/inbox"
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent"
            >
              <span className="size-2 shrink-0 rounded-full bg-error" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {item.agent.name}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {CHANNEL_LABELS[item.source] ?? item.source}
                  </span>
                </div>
                {item.lastMessage?.content && (
                  <div className="truncate text-xs text-muted-foreground">{item.lastMessage.content}</div>
                )}
              </div>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
                <Clock className="size-3.5" />
                {timeAgo(item.handoverRequestedAt)}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/* ── Your agents ──────────────────────────────────────────────────────── */

function AgentsPanel({
  agents,
  convByAgent,
  isLoading,
}: {
  agents: Agent[];
  convByAgent: Map<string, number>;
  isLoading: boolean;
}) {
  return (
    <Card className="gap-0 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Your agents</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Status and volume at a glance</p>
        </div>
        <SectionLink href="/dashboard/agents">Manage all</SectionLink>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
          : agents.slice(0, 5).map((agent) => {
              const live = agent.status === 'ACTIVE';
              return (
                <Link
                  key={agent.id}
                  href={`/dashboard/agents/${agent.id}`}
                  className="rounded-xl border border-border p-4 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground ring-1 ring-inset ring-border">
                      <Bot className="size-[1.1rem]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{agent.name}</div>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 text-xs font-medium',
                          live ? 'text-success-foreground' : 'text-muted-foreground',
                        )}
                      >
                        <span
                          className={cn('size-1.5 rounded-full', live ? 'bg-success-foreground' : 'bg-muted-foreground')}
                        />
                        {live ? 'Live' : 'Inactive'}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 border-t border-border pt-2.5 text-xs text-muted-foreground">
                    <span className="font-semibold tabular-nums text-foreground">
                      {formatCount(convByAgent.get(agent.id) ?? 0)}
                    </span>{' '}
                    conversations
                  </div>
                </Link>
              );
            })}

        {!isLoading && (
          <Link
            href="/dashboard/agents"
            className="flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border p-4 text-center transition-colors hover:border-primary/50 hover:bg-accent"
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Plus className="size-[1.1rem]" />
            </span>
            <span className="text-sm font-medium">New agent</span>
          </Link>
        )}
      </div>
    </Card>
  );
}

/* ── Handover health (containment ring) ───────────────────────────────── */

function HandoverHealth({
  containedPct,
  resolvedByHuman,
  handoverRate,
  waitingNow,
  isLoading,
}: {
  containedPct: number | null;
  resolvedByHuman: number;
  handoverRate: number;
  waitingNow: number;
  isLoading: boolean;
}) {
  const pct = containedPct ?? 0;
  const dash = `${Math.max(0, Math.min(100, pct))} 100`;
  return (
    <Card className="gap-0 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Handover health</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Resolved without a human</p>
        </div>
        <SectionLink href="/dashboard/analytics?tab=handover">Details</SectionLink>
      </div>

      {isLoading ? (
        <div className="mt-6 flex items-center gap-5">
          <Skeleton className="size-24 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ) : (
        <>
          <div className="mt-5 flex items-center gap-5">
            <div className="relative shrink-0">
              <svg viewBox="0 0 36 36" className="size-24 -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--muted)" strokeWidth="3.4" />
                <circle
                  cx="18"
                  cy="18"
                  r="15.9"
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="3.4"
                  strokeLinecap="round"
                  strokeDasharray={dash}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-lg font-semibold tabular-nums">
                {containedPct == null ? '—' : `${pct}%`}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{pct}%</span> of conversations were resolved without a
              human. The remaining <span className="font-medium text-foreground">{handoverRate}%</span> were handed
              off.
            </p>
          </div>

          <div className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Resolved by a human</span>
              <span className="font-semibold tabular-nums">{formatCount(resolvedByHuman)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Waiting now</span>
              <span
                className={cn(
                  'font-semibold tabular-nums',
                  waitingNow > 0 ? 'text-error-foreground' : 'text-foreground',
                )}
              >
                {formatCount(waitingNow)}
              </span>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

/* ── Recent conversations ─────────────────────────────────────────────── */

function RecentConversations({ items, isLoading }: { items: ConversationListItem[]; isLoading: boolean }) {
  return (
    <Card className="gap-0 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Recent conversations</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Latest activity</p>
        </div>
        <SectionLink href="/dashboard/conversations">View all</SectionLink>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full rounded-lg" />
            ))}
          </div>
        ) : items.length > 0 ? (
          <div className="divide-y divide-border">
            {items.slice(0, 6).map((c) => (
              <Link
                key={c.id}
                href={`/dashboard/conversations/${c.sessionId}`}
                className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-accent"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.title || c.agent.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {c.agent.name} · {CHANNEL_LABELS[c.source] ?? c.source} · {c.messageCount} msg
                  </div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {timeAgo(c.lastActivityAt)}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">No conversations in this range yet.</p>
        )}
      </div>
    </Card>
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

  const params = React.useMemo(() => {
    const now = new Date();
    return {
      startDate: formatDateLocal(subDays(now, rangeDays - 1)),
      endDate: formatDateLocal(now),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    };
  }, [rangeDays]);

  const summaryQuery = useAnalyticsSummary(params);
  const handoverQuery = useHandoverAnalytics(params);
  const leadsQuery = useLeadsCaptured(params);
  const chartQuery = useConversationsChart(params);
  const waitingQuery = useInbox('needs');
  const agentsQuery = useAgents({ limit: 6 });
  // Pull conversation counts for the whole agent set (not just a separate top-6
  // slice) so the counts line up with whichever agents the panel actually shows.
  const agentPerfQuery = useAgentAnalytics({
    ...params,
    page: 1,
    limit: 100,
    sortBy: 'conversations',
    sortOrder: 'desc',
  });
  const recentQuery = useConversations({
    limit: 6,
    sortBy: 'lastMessageAt',
    sortOrder: 'desc',
    from: toIsoStartOfDay(params.startDate),
    to: toIsoEndOfDay(params.endDate),
  });

  const firstName = (profile?.name?.trim() || profile?.email || 'there').split(' ')[0];

  const chartData = React.useMemo(
    () =>
      (chartQuery.data?.data ?? []).map((p) => ({
        label: new Date(p.date + 'T00:00:00').toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        }),
        count: p.count,
      })),
    [chartQuery.data],
  );
  const hasChartData = chartData.some((d) => d.count > 0);

  const convByAgent = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const row of agentPerfQuery.data?.data ?? []) m.set(row.agentId, row.conversations);
    return m;
  }, [agentPerfQuery.data]);

  const handoverRate = handoverQuery.data?.handoverRate ?? 0;
  const containedPct = handoverQuery.data ? Math.max(0, Math.round((100 - handoverRate) * 10) / 10) : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {firstName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&apos;s what needs you, and how your agents are running.
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

      {/* KPI row */}
      <Card className="gap-0 overflow-hidden p-0">
        <div className="grid grid-cols-4 divide-x divide-border">
          {KPIS.map((k) => {
            const kpi =
              k.source === 'handover'
                ? { value: handoverQuery.data?.handoverRate, trend: handoverQuery.data?.handoverRateTrend }
                : k.source === 'leads'
                  ? { value: leadsQuery.data?.totalLeads, trend: leadsQuery.data?.totalLeadsTrend }
                  : summaryQuery.data?.kpis?.[k.key as KpiKey];
            const loading =
              k.source === 'handover'
                ? handoverQuery.isLoading
                : k.source === 'leads'
                  ? leadsQuery.isLoading
                  : summaryQuery.isLoading;
            const value =
              k.kind === 'duration'
                ? formatDuration(kpi?.value ?? undefined)
                : k.kind === 'rate'
                  ? kpi?.value == null
                    ? '—'
                    : `${kpi.value}%`
                  : formatCount(kpi?.value ?? undefined);
            return (
              <div key={k.key} className="flex flex-col">
                <div className="flex items-center gap-2 border-b border-border px-5 py-3">
                  <k.icon className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">{k.label}</span>
                </div>
                <div className="px-5 py-4">
                  {loading ? (
                    <Skeleton className="h-8 w-24" />
                  ) : (
                    <div className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">{value}</div>
                  )}
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <TrendText value={kpi?.trend ?? undefined} positiveIsGood={k.positiveIsGood} />
                    <span className="text-xs text-muted-foreground">vs previous {rangeDays}d</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Needs attention */}
      <AttentionPanel
        waiting={waitingQuery.data ?? []}
        isLoading={waitingQuery.isLoading}
        isError={waitingQuery.isError}
      />

      {/* Agents + handover health */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <AgentsPanel
            agents={agentsQuery.data?.data ?? []}
            convByAgent={convByAgent}
            isLoading={agentsQuery.isLoading}
          />
        </div>
        <div className="col-span-1">
          <HandoverHealth
            containedPct={containedPct}
            resolvedByHuman={handoverQuery.data?.resolvedByHuman ?? 0}
            handoverRate={handoverRate}
            waitingNow={waitingQuery.data?.length ?? 0}
            isLoading={handoverQuery.isLoading}
          />
        </div>
      </div>

      {/* Conversations chart + recent conversations */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="col-span-2 gap-0 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Conversations</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">Daily volume · last {rangeDays} days</p>
            </div>
            <SectionLink href="/dashboard/analytics">Details</SectionLink>
          </div>
          <div className="mt-6 h-56 w-full">
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
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--primary)', strokeOpacity: 0.3 }} />
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

        <div className="col-span-1">
          <RecentConversations items={recentQuery.data?.data ?? []} isLoading={recentQuery.isLoading} />
        </div>
      </div>
    </div>
  );
}
