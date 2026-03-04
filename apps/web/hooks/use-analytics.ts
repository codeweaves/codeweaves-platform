'use client';

import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

export interface AnalyticsParams {
  startDate: string;
  endDate: string;
  agentId?: string;
  orgId?: string;
}

// Matches API: analytics.service.ts → getSummary()
export interface KpiValue {
  value: number;
  trend?: number;
}

export interface AnalyticsSummaryResponse {
  period: { start: string; end: string };
  kpis: {
    totalUsers: KpiValue;
    newUsers: KpiValue;
    returningUsers: KpiValue;
    totalConversations: KpiValue;
    totalMessagesSent: KpiValue;
    totalMessagesReceived: KpiValue;
    totalMessagesExchanged: KpiValue;
    userRetentionRate: KpiValue;
    userGrowthRate: KpiValue;
    avgResponseTimeMs: KpiValue;
    p50ResponseTimeMs: KpiValue;
    p95ResponseTimeMs: KpiValue;
    p99ResponseTimeMs: KpiValue;
    queriesRaised: KpiValue;
  };
}

// Matches API: analytics.service.ts → getConversationsChart()
export interface ConversationsChartPoint {
  date: string;
  count: number;
}

export interface ConversationsChartResponse {
  data: ConversationsChartPoint[];
}

// Matches API: analytics.service.ts → getResponseTimeDistribution()
export interface ResponseTimeBucket {
  label: string;
  min: number;
  max: number | null;
  count: number;
  percentage: number;
}

export interface ResponseTimesChartResponse {
  buckets: ResponseTimeBucket[];
  percentiles: { p50: number; p95: number; p99: number };
}

// Matches API: analytics.service.ts → getMessageVolumeHeatmap()
export interface MessageVolumePoint {
  day: number;
  hour: number;
  count: number;
}

export interface MessageVolumeResponse {
  data: MessageVolumePoint[];
}

// Matches API: analytics.service.ts → getAgentMetrics()
export interface AgentAnalyticsRow {
  agentId: string;
  agentName: string;
  conversations: number;
  messages: number;
  avgResponseTimeMs: number;
  queriesRaised: number;
}

export interface PaginatedAgentAnalytics {
  data: AgentAnalyticsRow[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Match backend Cache-Control: private, max-age=300
const ANALYTICS_STALE_TIME = 5 * 60 * 1000;

function buildQueryString(params: AnalyticsParams, extra?: Record<string, string | number | undefined>): string {
  const qp = new URLSearchParams();
  qp.set('startDate', params.startDate);
  qp.set('endDate', params.endDate);
  if (params.agentId) qp.set('agentId', params.agentId);
  if (params.orgId) qp.set('orgId', params.orgId);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) qp.set(k, String(v));
    }
  }
  return qp.toString();
}

export function useAnalyticsSummary(params: AnalyticsParams) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<AnalyticsSummaryResponse>({
    queryKey: ['analytics', 'summary', params],
    queryFn: () => api.get(`/analytics/summary?${buildQueryString(params)}`),
    enabled: isAuthenticated && !authLoading,
    staleTime: ANALYTICS_STALE_TIME,
  });
}

export function useConversationsChart(params: AnalyticsParams) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<ConversationsChartResponse>({
    queryKey: ['analytics', 'conversations', params],
    queryFn: () => api.get(`/analytics/charts/conversations?${buildQueryString(params)}`),
    enabled: isAuthenticated && !authLoading,
    staleTime: ANALYTICS_STALE_TIME,
  });
}

export function useResponseTimesChart(params: AnalyticsParams) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<ResponseTimesChartResponse>({
    queryKey: ['analytics', 'response-times', params],
    queryFn: () => api.get(`/analytics/charts/response-times?${buildQueryString(params)}`),
    enabled: isAuthenticated && !authLoading,
    staleTime: ANALYTICS_STALE_TIME,
  });
}

export function useMessageVolumeChart(params: AnalyticsParams) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<MessageVolumeResponse>({
    queryKey: ['analytics', 'message-volume', params],
    queryFn: () => api.get(`/analytics/charts/message-volume?${buildQueryString(params)}`),
    enabled: isAuthenticated && !authLoading,
    staleTime: ANALYTICS_STALE_TIME,
  });
}

export interface AgentAnalyticsParams extends AnalyticsParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export function useAgentAnalytics(params: AgentAnalyticsParams) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  const { page, limit, sortBy, sortOrder, ...baseParams } = params;

  return useQuery<PaginatedAgentAnalytics>({
    queryKey: ['analytics', 'agents', params],
    queryFn: () =>
      api.get(`/analytics/agents?${buildQueryString(baseParams, { page, limit, sortBy, sortOrder })}`),
    enabled: isAuthenticated && !authLoading,
    staleTime: ANALYTICS_STALE_TIME,
  });
}
