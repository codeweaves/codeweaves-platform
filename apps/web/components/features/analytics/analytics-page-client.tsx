'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useProfile } from '@/hooks/use-profile';
import { useAgents, type Agent } from '@/hooks/use-agents';
import { useOrganizations, type Organization } from '@/hooks/use-organizations';
import {
  useAnalyticsSummary,
  useConversationsChart,
  useResponseTimesChart,
  useMessageVolumeChart,
  useAgentAnalytics,
  type AnalyticsParams,
} from '@/hooks/use-analytics';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle } from 'lucide-react';
import { KpiSummaryCards } from './kpi-summary-cards';
import { DateRangeFilter, type DatePreset } from './date-range-filter';
import { ConversationsChart } from './conversations-chart';

// --- Date helpers (M3 fix: use local date, not UTC) ---
function formatDateLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function subDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

// --- Main Component ---
export function AnalyticsPageClient() {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router; // M1 fix: stable ref avoids useCallback/useEffect dep on router

  const searchParams = useSearchParams();
  const { profile, isLoading: profileLoading } = useProfile();

  const isAdmin = profile?.role === 'SUPER_ADMIN' || profile?.role === 'ADMIN';

  // --- Filter State (Task 3) ---
  const [datePreset, setDatePreset] = useState<DatePreset>(() => {
    const p = searchParams.get('range');
    return (p === '7' || p === '14' || p === '30' || p === 'custom') ? p : '7';
  });

  const [startDate, setStartDate] = useState<Date>(() => {
    const s = searchParams.get('start');
    if (s) return new Date(s + 'T00:00:00');
    return subDays(new Date(), 7);
  });

  const [endDate, setEndDate] = useState<Date>(() => {
    const e = searchParams.get('end');
    if (e) return new Date(e + 'T00:00:00');
    return new Date();
  });

  const [agentId, setAgentId] = useState<string | undefined>(
    searchParams.get('agentId') ?? undefined,
  );

  const [orgId, setOrgId] = useState<string | undefined>(
    searchParams.get('orgId') ?? undefined,
  );

  // Sync filter state to URL (Task 3.5) — M1 fix: no router in deps
  const syncUrl = useCallback(() => {
    const params = new URLSearchParams();
    params.set('range', datePreset);
    params.set('start', formatDateLocal(startDate));
    params.set('end', formatDateLocal(endDate));
    if (agentId) params.set('agentId', agentId);
    if (orgId) params.set('orgId', orgId);
    routerRef.current.replace(`?${params.toString()}`, { scroll: false });
  }, [datePreset, startDate, endDate, agentId, orgId]);

  useEffect(() => {
    syncUrl();
  }, [syncUrl]);

  // Update dates when preset changes
  const handlePresetChange = useCallback((preset: DatePreset) => {
    setDatePreset(preset);
    if (preset !== 'custom') {
      const days = Number(preset);
      setStartDate(subDays(new Date(), days));
      setEndDate(new Date());
    }
  }, []);

  // --- Data Fetching ---
  const analyticsParams: AnalyticsParams = {
    startDate: formatDateLocal(startDate),
    endDate: formatDateLocal(endDate),
    agentId,
    orgId: isAdmin ? orgId : undefined,
  };

  const summaryQuery = useAnalyticsSummary(analyticsParams);
  const conversationsQuery = useConversationsChart(analyticsParams);
  const responseTimesQuery = useResponseTimesChart(analyticsParams);
  const messageVolumeQuery = useMessageVolumeChart(analyticsParams);
  const agentMetricsQuery = useAgentAnalytics(analyticsParams);

  // Agent list for filter dropdown (Task 3.3)
  const { data: agentsData } = useAgents({ limit: 100 });
  const agents: Agent[] = agentsData?.data ?? [];

  // Org list for admin filter (Task 3.4)
  // Hook always called (React rules); endpoint returns 403 for CLIENT — React Query handles silently
  const { data: orgsData } = useOrganizations({ limit: 100 });
  const organizations: Organization[] = isAdmin ? (orgsData?.data ?? []) : [];

  // M2: aggregate error state
  const hasError = summaryQuery.isError || conversationsQuery.isError ||
    responseTimesQuery.isError || messageVolumeQuery.isError || agentMetricsQuery.isError;

  if (profileLoading) {
    return <AnalyticsPageSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Header (Task 1.3) */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground">
          View performance metrics across your agents.
        </p>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-4">
        <DateRangeFilter
          preset={datePreset}
          startDate={startDate}
          endDate={endDate}
          onPresetChange={handlePresetChange}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
        />

        {/* Agent Filter */}
        <Select
          value={agentId ?? ''}
          onValueChange={(v) => setAgentId(v || undefined)}
        >
          <SelectTrigger className="w-45">
            <SelectValue placeholder="All agents" />
          </SelectTrigger>
          <SelectContent allowClear clearLabel="All agents">
            {agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Org Filter — admin only */}
        {isAdmin && (
          <Select
            value={orgId ?? ''}
            onValueChange={(v) => setOrgId(v || undefined)}
          >
            <SelectTrigger className="w-45">
              <SelectValue placeholder="All organizations" />
            </SelectTrigger>
            <SelectContent allowClear clearLabel="All organizations">
              {organizations.map((org) => (
                <SelectItem key={org.id} value={org.id}>
                  {org.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* M2: Error banner */}
      {hasError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <p>Failed to load some analytics data. Please try again later.</p>
        </div>
      )}

      {/* KPI Summary Cards (Story 8-3) */}
      <KpiSummaryCards data={summaryQuery.data} isLoading={summaryQuery.isLoading} />

      {/* Charts Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ConversationsChart
          data={conversationsQuery.data}
          isLoading={conversationsQuery.isLoading}
          isError={conversationsQuery.isError}
        />
        <ChartPlaceholder
          title="Response Time Distribution"
          subtitle="Story 8-6"
          isLoading={responseTimesQuery.isLoading}
        />
        <ChartPlaceholder
          title="Message Volume by Hour"
          subtitle="Story 8-7"
          isLoading={messageVolumeQuery.isLoading}
          className="lg:col-span-2"
        />
      </div>

      {/* Agent Analytics Table — placeholder for story 8-8 (Task 1.7, AC 5) */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle>Agent Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {agentMetricsQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                Per-agent analytics table will be implemented in story 8-8.
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

// --- Sub-components ---

function ChartPlaceholder({
  title,
  subtitle,
  isLoading,
  className,
}: {
  title: string;
  subtitle: string;
  isLoading: boolean;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-50 w-full" />
        ) : (
          <div className="flex h-50 items-center justify-center rounded-md border border-dashed">
            <p className="text-muted-foreground text-sm">
              Chart placeholder ({subtitle})
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Full Page Skeleton (Task 1.8, AC 6) ---
function AnalyticsPageSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Skeleton className="h-9 w-35" />
        <Skeleton className="h-9 w-45" />
        <Skeleton className="h-9 w-45" />
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-50 w-full" />
            </CardContent>
          </Card>
        ))}
        <Card className="lg:col-span-2">
          <CardHeader>
            <Skeleton className="h-5 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-50 w-full" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-36" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
