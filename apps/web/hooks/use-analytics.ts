'use client';

import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

export interface AnalyticsParams {
  startDate: string;
  endDate: string;
  agentId?: string;
  orgId?: string;
  source?: 'WIDGET' | 'WHATSAPP';
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
  if (params.source) qp.set('source', params.source);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) qp.set(k, String(v));
    }
  }
  return qp.toString();
}

export interface AnalyticsQueryOptions {
  refetchInterval?: number | false;
}

/** When polling is active, staleTime must be shorter than the interval so React Query actually refetches. */
function resolveStaleTime(options?: AnalyticsQueryOptions): number {
  return options?.refetchInterval ? 0 : ANALYTICS_STALE_TIME;
}

export function useAnalyticsSummary(params: AnalyticsParams, options?: AnalyticsQueryOptions) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<AnalyticsSummaryResponse>({
    queryKey: ['analytics', 'summary', params],
    queryFn: () => api.get(`/analytics/summary?${buildQueryString(params)}`),
    enabled: isAuthenticated && !authLoading,
    staleTime: resolveStaleTime(options),
    refetchInterval: options?.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}

export function useConversationsChart(params: AnalyticsParams, options?: AnalyticsQueryOptions) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<ConversationsChartResponse>({
    queryKey: ['analytics', 'conversations', params],
    queryFn: () => api.get(`/analytics/charts/conversations?${buildQueryString(params)}`),
    enabled: isAuthenticated && !authLoading,
    staleTime: resolveStaleTime(options),
    refetchInterval: options?.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}

export function useResponseTimesChart(params: AnalyticsParams, options?: AnalyticsQueryOptions) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<ResponseTimesChartResponse>({
    queryKey: ['analytics', 'response-times', params],
    queryFn: () => api.get(`/analytics/charts/response-times?${buildQueryString(params)}`),
    enabled: isAuthenticated && !authLoading,
    staleTime: resolveStaleTime(options),
    refetchInterval: options?.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}

export function useMessageVolumeChart(params: AnalyticsParams, options?: AnalyticsQueryOptions) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<MessageVolumeResponse>({
    queryKey: ['analytics', 'message-volume', params],
    queryFn: () => api.get(`/analytics/charts/message-volume?${buildQueryString(params)}`),
    enabled: isAuthenticated && !authLoading,
    staleTime: resolveStaleTime(options),
    refetchInterval: options?.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}

// ==========================================
// Voice Analytics Types & Hooks (Story 10-14)
// ==========================================

export interface VoiceSummaryResponse {
  totalVoiceMessages: number;
  totalTextMessages: number;
  voiceRatio: number;
  avgSttLatencyMs: number;
  avgTtsLatencyMs: number;
  voiceErrorCount: number;
  trend: { voiceMessagesTrend: number };
}

export interface LanguageDistributionEntry {
  language: string;
  count: number;
  percentage: number;
}

export interface LanguageDistributionResponse {
  languages: LanguageDistributionEntry[];
}

export interface ProviderLatencyEntry {
  provider: string;
  avg: number;
  p50: number;
  p95: number;
  count: number;
}

export interface VoiceLatencyResponse {
  stt: ProviderLatencyEntry[];
  tts: ProviderLatencyEntry[];
}

export function useVoiceSummary(params: AnalyticsParams, options?: AnalyticsQueryOptions) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<VoiceSummaryResponse>({
    queryKey: ['analytics', 'voice-summary', params],
    queryFn: () => api.get(`/analytics/voice/summary?${buildQueryString(params)}`),
    enabled: isAuthenticated && !authLoading,
    staleTime: resolveStaleTime(options),
    refetchInterval: options?.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}

export function useLanguageDistribution(params: AnalyticsParams, options?: AnalyticsQueryOptions & { enabled?: boolean }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<LanguageDistributionResponse>({
    queryKey: ['analytics', 'voice-languages', params],
    queryFn: () => api.get(`/analytics/voice/languages?${buildQueryString(params)}`),
    enabled: isAuthenticated && !authLoading && (options?.enabled !== false),
    staleTime: resolveStaleTime(options),
    refetchInterval: options?.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}

export function useVoiceLatency(params: AnalyticsParams, options?: AnalyticsQueryOptions & { enabled?: boolean }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<VoiceLatencyResponse>({
    queryKey: ['analytics', 'voice-latency', params],
    queryFn: () => api.get(`/analytics/voice/latency?${buildQueryString(params)}`),
    enabled: isAuthenticated && !authLoading && (options?.enabled !== false),
    staleTime: resolveStaleTime(options),
    refetchInterval: options?.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}

export interface AgentAnalyticsParams extends AnalyticsParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export function useAgentAnalytics(params: AgentAnalyticsParams, options?: AnalyticsQueryOptions) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  const { page, limit, sortBy, sortOrder, ...baseParams } = params;

  return useQuery<PaginatedAgentAnalytics>({
    queryKey: ['analytics', 'agents', params],
    queryFn: () =>
      api.get(`/analytics/agents?${buildQueryString(baseParams, { page, limit, sortBy, sortOrder })}`),
    enabled: isAuthenticated && !authLoading,
    staleTime: resolveStaleTime(options),
    refetchInterval: options?.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}
