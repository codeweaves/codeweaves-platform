'use client';

import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

export type ConversationSource = 'WIDGET' | 'WHATSAPP' | 'DEMO';
export type ConversationStatus = 'ACTIVE' | 'EXPIRED';
export type MessageRole = 'USER' | 'ASSISTANT' | 'HUMAN_AGENT' | 'SYSTEM';

export interface ConversationListItem {
  id: string;
  sessionId: string;
  agent: { id: string; name: string };
  organizationId: string;
  source: ConversationSource;
  status: ConversationStatus;
  visitorId: string | null;
  title: string | null;
  /** Category assigned by the background classifier; null until classified. */
  category: string | null;
  /** ISO 639-1 code assigned by the background classifier; null until set. */
  detectedLanguage: string | null;
  messageCount: number;
  createdAt: string;
  lastMessageAt: string | null;
  /** lastMessageAt ?? createdAt — always present, safe to display directly. */
  lastActivityAt: string;
}

export interface PaginatedConversations {
  data: ConversationListItem[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ConversationListParams {
  page?: number;
  limit?: number;
  search?: string;
  agentId?: string;
  agentIds?: string[];
  orgId?: string;
  source?: ConversationSource;
  sources?: ConversationSource[];
  status?: ConversationStatus;
  statuses?: ConversationStatus[];
  categories?: string[];
  visitorId?: string;
  from?: string;
  to?: string;
  sortBy?: 'lastMessageAt' | 'createdAt' | 'messageCount';
  sortOrder?: 'asc' | 'desc';
}

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  metadata: unknown;
  createdAt: string;
  /**
   * Fallback detection result for assistant replies: true = matched one of the
   * agent's fallback phrases (a "couldn't answer"), false = checked but didn't,
   * null = not checked (agent had no fallback phrases at the time).
   */
  couldntAnswer: boolean | null;
}

export interface ConversationTrace {
  id: string;
  traceId: string;
  messageId: string | null;
  model: string | null;
  steps: unknown;
  startedAt: string;
  completedAt: string | null;
  totalDurationMs: number | null;
  success: boolean;
  errorMessage: string | null;
}

export interface ConversationDetail {
  id: string;
  sessionId: string;
  source: ConversationSource;
  status: ConversationStatus;
  visitorId: string | null;
  title: string | null;
  summary: string | null;
  category: string | null;
  detectedLanguage: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  agent: {
    id: string;
    name: string;
    organization: { id: string; name: string; slug: string } | null;
  };
  messages: ConversationMessage[];
  traces: ConversationTrace[];
}

function buildQuery(params: ConversationListParams): string {
  const qp = new URLSearchParams();
  if (params.page) qp.set('page', String(params.page));
  if (params.limit) qp.set('limit', String(params.limit));
  if (params.search) qp.set('search', params.search);
  if (params.agentId) qp.set('agentId', params.agentId);
  if (params.agentIds?.length) qp.set('agentIds', params.agentIds.join(','));
  if (params.orgId) qp.set('orgId', params.orgId);
  if (params.source) qp.set('source', params.source);
  if (params.sources?.length) qp.set('sources', params.sources.join(','));
  if (params.status) qp.set('status', params.status);
  if (params.statuses?.length) qp.set('statuses', params.statuses.join(','));
  if (params.categories?.length) qp.set('categories', params.categories.join(','));
  if (params.visitorId) qp.set('visitorId', params.visitorId);
  if (params.from) qp.set('from', params.from);
  if (params.to) qp.set('to', params.to);
  if (params.sortBy) qp.set('sortBy', params.sortBy);
  if (params.sortOrder) qp.set('sortOrder', params.sortOrder);
  const s = qp.toString();
  return s ? `?${s}` : '';
}

export interface ConversationsQueryOptions {
  /** Poll interval in ms, or false to disable. Callers pass false when the tab is hidden. */
  refetchInterval?: number | false;
}

/**
 * The global 5-minute staleTime would swallow a poll — React Query skips a
 * scheduled refetch while the data is still fresh. So polling callers get a
 * staleTime of 0, and everyone else keeps the default.
 */
function resolveStaleTime(options?: ConversationsQueryOptions): number {
  return options?.refetchInterval ? 0 : 5 * 60_000;
}

export function useConversations(
  params: ConversationListParams = {},
  options?: ConversationsQueryOptions,
) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<PaginatedConversations>({
    queryKey: ['conversations', params],
    queryFn: () => api.get(`/conversations${buildQuery(params)}`),
    enabled: isAuthenticated && !authLoading,
    staleTime: resolveStaleTime(options),
    refetchInterval: options?.refetchInterval ?? false,
    // Never poll a backgrounded tab — a dashboard left open overnight should
    // cost nothing.
    refetchIntervalInBackground: false,
    // Overrides the global `false` for polling callers only. Polling pauses on a
    // hidden tab, so without a catch-up on return you would stare at data up to
    // a whole poll interval old. Fixing the staleness beats labelling it.
    refetchOnWindowFocus: Boolean(options?.refetchInterval),
    // Filters and pages change the key; without this the list empties on every
    // change. Callers distinguish "new query loading" from "background poll"
    // via `isPlaceholderData`.
    placeholderData: (previous) => previous,
  });
}

export function useConversation(
  sessionId: string | undefined,
  options?: ConversationsQueryOptions,
) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<ConversationDetail>({
    queryKey: ['conversations', 'detail', sessionId],
    queryFn: () => api.get(`/conversations/${sessionId}`),
    enabled: isAuthenticated && !authLoading && !!sessionId,
    staleTime: resolveStaleTime(options),
    // Only an ACTIVE conversation can gain messages. An EXPIRED transcript is
    // immutable, so polling one is pure waste — stop as soon as we know.
    refetchInterval: (query) =>
      query.state.data?.status === 'ACTIVE'
        ? (options?.refetchInterval ?? false)
        : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: Boolean(options?.refetchInterval),
  });
}
