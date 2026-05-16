'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useProfile } from '@/hooks/use-profile';
import { usePageHeader } from '@/components/layout/page-header';
import { useTabVisible } from '@/hooks/use-tab-visible';
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
import { SearchableMultiSelect } from '@/components/ui/searchable-multi-select';
import { MultiSelect } from '@/components/ui/multi-select';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle } from 'lucide-react';
import { KpiSummaryCards } from './kpi-summary-cards';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { ConversationsChart } from './conversations-chart';
import { ResponseTimesChart } from './response-times-chart';
import { MessageVolumeHeatmap } from './message-volume-heatmap';
import { AgentAnalyticsTable } from './agent-analytics-table';
import { AnalyticsEmptyState } from './analytics-empty-state';
import { AnalyticsExportButton } from './analytics-export-button';
import { VoiceAnalyticsSection } from './voice-analytics-section';
import { resolveTimezone, TimezoneToggle, type TzMode } from './timezone-toggle';

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

// --- Timezone helpers ---
const TZ_STORAGE_KEY = 'analytics:timezone-mode';

function loadTzMode(): TzMode {
  if (typeof window === 'undefined') return 'local';
  const stored = window.localStorage.getItem(TZ_STORAGE_KEY);
  return stored === 'utc' ? 'utc' : 'local';
}

// --- Main Component ---
export function AnalyticsPageClient() {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router; // M1 fix: stable ref avoids useCallback/useEffect dep on router

  const searchParams = useSearchParams();
  const { profile, isLoading: profileLoading } = useProfile();

  const { setTitle } = usePageHeader();
  const isAdmin = profile?.role === 'SUPER_ADMIN' || profile?.role === 'ADMIN';

  useEffect(() => {
    setTitle('Analytics');
    return () => setTitle('');
  }, [setTitle]);

  // 8-9: Polling — pause when tab is inactive
  const isTabVisible = useTabVisible();
  const refetchInterval: number | false = isTabVisible ? 60_000 : false;

  // --- Filter State (Task 3) ---
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

  const [agentIds, setAgentIds] = useState<string[]>(() => {
    const raw = searchParams.get('agentIds') ?? searchParams.get('agentId');
    return raw ? raw.split(',').filter(Boolean) : [];
  });

  const [orgIds, setOrgIds] = useState<string[]>(() => {
    const raw = searchParams.get('orgIds') ?? searchParams.get('orgId');
    return raw ? raw.split(',').filter(Boolean) : [];
  });

  const [sources, setSources] = useState<Array<'WIDGET' | 'WHATSAPP' | 'DEMO'>>(() => {
    const raw = searchParams.get('sources') ?? searchParams.get('source');
    if (!raw) return [];
    return raw
      .split(',')
      .filter((s): s is 'WIDGET' | 'WHATSAPP' | 'DEMO' => s === 'WIDGET' || s === 'WHATSAPP' || s === 'DEMO');
  });

  // Local vs UTC interpretation of the date range and timestamps. Persists in
  // localStorage so the user's choice sticks across reloads. Default 'local'
  // re-resolves the browser timezone every render so travelers/movers get the
  // right zone even if their preference was saved months ago.
  const [tzMode, setTzMode] = useState<TzMode>(() => loadTzMode());
  const timezone = resolveTimezone(tzMode);
  const handleTzModeChange = useCallback((mode: TzMode) => {
    setTzMode(mode);
    try {
      window.localStorage.setItem(TZ_STORAGE_KEY, mode);
    } catch {
      // ignore storage failures (private mode, quota)
    }
  }, []);

  // Sync filter state to URL (Task 3.5) — M1 fix: no router in deps
  const syncUrl = useCallback(() => {
    const params = new URLSearchParams();
    params.set('start', formatDateLocal(startDate));
    params.set('end', formatDateLocal(endDate));
    if (agentIds.length > 0) params.set('agentIds', agentIds.join(','));
    if (orgIds.length > 0) params.set('orgIds', orgIds.join(','));
    if (sources.length > 0) params.set('sources', sources.join(','));
    routerRef.current.replace(`?${params.toString()}`, { scroll: false });
  }, [startDate, endDate, agentIds, orgIds, sources]);

  useEffect(() => {
    syncUrl();
  }, [syncUrl]);

  const handleDateRangeChange = useCallback((from: string, to: string) => {
    if (from && to) {
      setStartDate(new Date(from + 'T00:00:00'));
      setEndDate(new Date(to + 'T00:00:00'));
    } else {
      // Cleared — reset to last 7 days
      setStartDate(subDays(new Date(), 7));
      setEndDate(new Date());
    }
  }, []);

  // --- Data Fetching ---
  const analyticsParams: AnalyticsParams = {
    startDate: formatDateLocal(startDate),
    endDate: formatDateLocal(endDate),
    timezone,
    agentIds: agentIds.length > 0 ? agentIds : undefined,
    orgIds: isAdmin && orgIds.length > 0 ? orgIds : undefined,
    sources: sources.length > 0 ? sources : undefined,
  };

  const pollingOptions = { refetchInterval };
  const summaryQuery = useAnalyticsSummary(analyticsParams, pollingOptions);
  const conversationsQuery = useConversationsChart(analyticsParams, pollingOptions);
  const responseTimesQuery = useResponseTimesChart(analyticsParams, pollingOptions);
  const messageVolumeQuery = useMessageVolumeChart(analyticsParams, pollingOptions);

  // 8-11: Fetch all agent metrics for export (high limit, no polling — only used on export click)
  const exportAgentsQuery = useAgentAnalytics(
    { ...analyticsParams, limit: 100, sortBy: 'conversations', sortOrder: 'desc' },
  );

  // Agent list for filter dropdown (Task 3.3)
  const { data: agentsData } = useAgents({ limit: 100 });
  const agents: Agent[] = agentsData?.data ?? [];

  // Org list for admin filter (Task 3.4)
  // Hook always called (React rules); endpoint returns 403 for CLIENT — React Query handles silently
  const { data: orgsData } = useOrganizations({ limit: 100 });
  const organizations: Organization[] = isAdmin ? (orgsData?.data ?? []) : [];

  // M2: aggregate error state
  const hasError = summaryQuery.isError || conversationsQuery.isError ||
    responseTimesQuery.isError || messageVolumeQuery.isError;

  // 8-10: Empty state detection — treat "no data" as all primary KPIs being zero
  const hasAgents = (agentsData?.meta?.total ?? 0) > 0;
  const kpis = summaryQuery.data?.kpis;
  const hasData = kpis != null && (
    kpis.totalConversations.value > 0 ||
    kpis.totalUsers.value > 0 ||
    kpis.totalMessagesSent.value > 0
  );
  const showEmptyState = !summaryQuery.isLoading && !hasData && !hasError;

  if (profileLoading) {
    return <AnalyticsPageSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-4">
        <DateRangePicker
          fromValue={formatDateLocal(startDate)}
          toValue={formatDateLocal(endDate)}
          onChange={handleDateRangeChange}
          placeholder="Pick a date range"
          showClear={false}
          popoverHeader={<TimezoneToggle mode={tzMode} onChange={handleTzModeChange} />}
        />

        {/* Agent Filter */}
        <SearchableMultiSelect
          triggerClassName="w-[250px]"
          placeholder="All agents"
          searchPlaceholder="Search agents..."
          emptyMessage="No agents found"
          values={agentIds}
          onValuesChange={setAgentIds}
          selectedLabel={(n) => `${n} agents`}
          options={agents.map((agent) => ({ value: agent.id, label: agent.name }))}
        />

        {/* Org Filter — admin only */}
        {isAdmin && (
          <SearchableMultiSelect
            triggerClassName="w-[250px]"
            placeholder="All organizations"
            searchPlaceholder="Search organizations..."
            emptyMessage="No organizations found"
            values={orgIds}
            onValuesChange={setOrgIds}
            selectedLabel={(n) => `${n} organizations`}
            options={organizations.map((org) => ({ value: org.id, label: org.name }))}
          />
        )}

        {/* Source Filter */}
        <MultiSelect
          triggerClassName="w-[250px]"
          placeholder="All channels"
          values={sources}
          onValuesChange={(v) => setSources(v as Array<'WIDGET' | 'WHATSAPP' | 'DEMO'>)}
          selectedLabel={(n) => `${n} channels`}
          options={[
            { value: 'WIDGET', label: 'Widget' },
            { value: 'WHATSAPP', label: 'WhatsApp' },
            { value: 'DEMO', label: 'Demo' },
          ]}
        />

        {/* 8-11: Export button (TZ toggle lives inside the heatmap card) */}
        <div className="ml-auto">
          <AnalyticsExportButton
            summaryData={summaryQuery.data}
            agentData={exportAgentsQuery.data?.data ?? []}
            startDate={analyticsParams.startDate}
            endDate={analyticsParams.endDate}
            orgName={profile?.organization?.name ?? 'all'}
            disabled={showEmptyState}
          />
        </div>
      </div>

      {/* M2: Error banner */}
      {hasError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <p>Failed to load some analytics data. Please try again later.</p>
        </div>
      )}

      {/* 8-10: Empty state replaces entire content area */}
      {showEmptyState ? (
        <AnalyticsEmptyState hasAgents={hasAgents} />
      ) : (
        <>
          {/* KPI Summary Cards (Story 8-3) */}
          <KpiSummaryCards data={summaryQuery.data} isLoading={summaryQuery.isLoading} />

          {/* Charts Grid */}
          <div className="grid gap-6 lg:grid-cols-2">
            <ConversationsChart
              data={conversationsQuery.data}
              isLoading={conversationsQuery.isLoading}
              isError={conversationsQuery.isError}
            />
            <ResponseTimesChart
              data={responseTimesQuery.data}
              isLoading={responseTimesQuery.isLoading}
              isError={responseTimesQuery.isError}
            />
            <MessageVolumeHeatmap
              data={messageVolumeQuery.data}
              isLoading={messageVolumeQuery.isLoading}
              isError={messageVolumeQuery.isError}
            />
          </div>

          {/* Agent Analytics Table (Story 8-8) */}
          <AgentAnalyticsTable params={analyticsParams} pollingOptions={pollingOptions} />

          {/* Voice Analytics Section (Story 10-14) */}
          <div>
            <h2 className="mb-4 text-lg font-semibold">Voice Analytics</h2>
            <VoiceAnalyticsSection params={analyticsParams} pollingOptions={pollingOptions} />
          </div>
        </>
      )}
    </div>
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

