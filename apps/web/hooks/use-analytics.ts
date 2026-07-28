'use client';

import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

export interface AnalyticsParams {
  startDate: string;
  endDate: string;
  /**
   * IANA timezone name (e.g. `Asia/Kolkata`, `America/New_York`, or `UTC`).
   * Determines how the [startDate, endDate] range is interpreted server-side
   * AND how time-bucketed charts (daily counts, hour-of-day heatmap) are
   * grouped. Defaults to `UTC` if omitted.
   */
  timezone?: string;
  /** Single agent filter (legacy, still supported) */
  agentId?: string;
  /** Multiple agent filter */
  agentIds?: string[];
  /** Single org filter (legacy, still supported) */
  orgId?: string;
  /** Multiple org filter */
  orgIds?: string[];
  source?: 'WIDGET' | 'WHATSAPP' | 'DEMO';
  sources?: Array<'WIDGET' | 'WHATSAPP' | 'DEMO'>;
}

// Matches API: analytics.service.ts → getSummary()
export interface KpiValue {
  value: number;
  trend?: number;
}

export interface AnalyticsSummaryResponse {
  period: { start: string; end: string };
  /**
   * True when at least one agent in view currently has fallback phrases set up.
   * Drives whether the "Fallback Rate" KPI card is shown at all — no phrases
   * means nothing to measure, so the card is hidden.
   */
  fallbackConfigured: boolean;
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
    // TTFT is only populated for streaming/direct-mode replies; null otherwise.
    avgTimeToFirstTokenMs: { value: number | null; trend: number | null };
    // Share of replies the agent flagged as "couldn't answer" (fallback phrases).
    couldntAnswerRate: KpiValue;
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

// Matches API: analytics.service.ts → getConversationsByWeekday()
export interface WeekdayConversationsPoint {
  day: number; // 0=Sun .. 6=Sat
  count: number;
}

export interface WeekdayConversationsResponse {
  data: WeekdayConversationsPoint[];
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
  if (params.timezone) qp.set('timezone', params.timezone);
  if (params.agentId) qp.set('agentId', params.agentId);
  if (params.agentIds && params.agentIds.length > 0) qp.set('agentIds', params.agentIds.join(','));
  if (params.orgId) qp.set('orgId', params.orgId);
  if (params.orgIds && params.orgIds.length > 0) qp.set('orgIds', params.orgIds.join(','));
  if (params.source) qp.set('source', params.source);
  if (params.sources && params.sources.length > 0) qp.set('sources', params.sources.join(','));
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) qp.set(k, String(v));
    }
  }
  return qp.toString();
}

export interface AnalyticsQueryOptions {
  refetchInterval?: number | false;
  /** Gate the query. Defaults to enabled; pass false to defer the fetch. */
  enabled?: boolean;
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

export function useConversationsByWeekday(params: AnalyticsParams, options?: AnalyticsQueryOptions) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<WeekdayConversationsResponse>({
    queryKey: ['analytics', 'conversations-by-weekday', params],
    queryFn: () => api.get(`/analytics/charts/conversations-by-weekday?${buildQueryString(params)}`),
    enabled: isAuthenticated && !authLoading,
    staleTime: resolveStaleTime(options),
    refetchInterval: options?.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}

// ==========================================
// Conversation Classification & Channel Types & Hooks
// ==========================================

// Matches API: analytics.service.ts → getConversationCategories()
export interface CategoryEntry {
  category: string;
  count: number;
  percentage: number;
}

export interface ConversationCategoriesResponse {
  categories: CategoryEntry[];
  /** Conversations not yet classified (null category) — shown for honest coverage. */
  uncategorized: number;
}

// Matches API: analytics.service.ts → getConversationLanguages()
export interface ConversationLanguageEntry {
  language: string;
  count: number;
  percentage: number;
}

export interface ConversationLanguagesResponse {
  languages: ConversationLanguageEntry[];
}

// Matches API: analytics.service.ts → getConversationChannels()
export interface ChannelEntry {
  source: string;
  count: number;
  percentage: number;
}

export interface ConversationChannelsResponse {
  channels: ChannelEntry[];
}

export function useConversationCategories(params: AnalyticsParams, options?: AnalyticsQueryOptions) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<ConversationCategoriesResponse>({
    queryKey: ['analytics', 'conversation-categories', params],
    queryFn: () => api.get(`/analytics/conversations/categories?${buildQueryString(params)}`),
    enabled: isAuthenticated && !authLoading,
    staleTime: resolveStaleTime(options),
    refetchInterval: options?.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}

export function useConversationLanguages(params: AnalyticsParams, options?: AnalyticsQueryOptions) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<ConversationLanguagesResponse>({
    queryKey: ['analytics', 'conversation-languages', params],
    queryFn: () => api.get(`/analytics/conversations/languages?${buildQueryString(params)}`),
    enabled: isAuthenticated && !authLoading,
    staleTime: resolveStaleTime(options),
    refetchInterval: options?.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}

export function useConversationChannels(params: AnalyticsParams, options?: AnalyticsQueryOptions) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<ConversationChannelsResponse>({
    queryKey: ['analytics', 'conversation-channels', params],
    queryFn: () => api.get(`/analytics/conversations/channels?${buildQueryString(params)}`),
    enabled: isAuthenticated && !authLoading,
    staleTime: resolveStaleTime(options),
    refetchInterval: options?.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}

// ==========================================
// Handover Analytics Types & Hook
// ==========================================

// Matches API: analytics.service.ts → getHandoverMetrics()
export interface HandoverReasonEntry {
  reason: string;
  count: number;
  percentage: number;
}

export interface HandoverAnalyticsResponse {
  period: { start: string; end: string };
  /** Handover cycles requested in the period (one per request). */
  totalHandovers: number;
  totalHandoversTrend: number;
  /** Conversations in the period — the denominator for handoverRate. */
  totalConversations: number;
  /** % of conversations that raised a handover. */
  handoverRate: number;
  handoverRateTrend: number;
  /** Cycles a human actually took over. */
  takenOver: number;
  takenOverTrend: number;
  /** % of requested handovers a human took over. */
  takenOverRate: number;
  /** Cycles a teammate explicitly resolved. */
  resolvedByHuman: number;
  resolvedByHumanTrend: number;
  /** Cycles auto-resolved by the idle sweep (total). */
  autoResolved: number;
  /** Requested but never taken over, then swept (true abandonment). */
  abandoned: number;
  /** Taken over by a human, then swept idle (walked away without resolving). */
  sweptAfterTakeover: number;
  /** Avg ms from request → human takeover. Null when nothing was taken over. */
  avgWaitMs: number | null;
  avgWaitTrend: number | null;
  /** Avg ms from takeover → resolve. Null when nothing was human-resolved. */
  avgHandleMs: number | null;
  avgHandleTrend: number | null;
  reasons: HandoverReasonEntry[];
}

export function useHandoverAnalytics(params: AnalyticsParams, options?: AnalyticsQueryOptions) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<HandoverAnalyticsResponse>({
    queryKey: ['analytics', 'handover', params],
    queryFn: () => api.get(`/analytics/handover?${buildQueryString(params)}`),
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

/** Provider-agnostic latency aggregate (what the client sees — no provider). */
export interface LatencyAggregate {
  avg: number;
  p50: number;
  p95: number;
  count: number;
}

export interface ProviderLatencyEntry {
  provider: string;
  avg: number;
  p50: number;
  p95: number;
  count: number;
}

export interface VoiceLatencyResponse {
  /** Per-provider breakdown — reserved for an internal/admin view, not shown to clients. */
  stt: ProviderLatencyEntry[];
  tts: ProviderLatencyEntry[];
  /** Provider-agnostic STT/TTS latency shown on the client Voice tab. */
  sttAggregate: LatencyAggregate | null;
  ttsAggregate: LatencyAggregate | null;
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
    enabled: isAuthenticated && !authLoading && (options?.enabled !== false),
    staleTime: resolveStaleTime(options),
    refetchInterval: options?.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}
