'use client';

import { useEffect } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { ensureHandoverSocket, profileHandoverAuth } from '@/lib/handover-socket';

export type HandoverState = 'NONE' | 'REQUESTED' | 'ACTIVE_HUMAN';
export type HandoverReason = 'USER_REQUESTED' | 'BOT_FALLBACK' | 'FRUSTRATION' | 'MANUAL';
export type HandoverFilter = 'needs' | 'handling' | 'all';
export type HandoverMessageRole = 'USER' | 'ASSISTANT' | 'HUMAN_AGENT' | 'SYSTEM';

export interface InboxItem {
  id: string;
  sessionId: string;
  agent: { id: string; name: string };
  source: 'WIDGET' | 'WHATSAPP' | 'DEMO';
  visitorId: string | null;
  handoverState: HandoverState;
  handoverReason: HandoverReason | null;
  handoverRequestedAt: string | null;
  takenOverBy: { id: string; name: string | null } | null;
  lastMessageAt: string | null;
  messageCount: number;
  lastMessage: { role: HandoverMessageRole; content: string; createdAt: string } | null;
}

export interface ThreadMessage {
  id: string;
  role: HandoverMessageRole;
  content: string;
  createdAt: string;
  author: string | null;
}

export interface HandoverThread {
  sessionId: string;
  agent: { id: string; name: string; organizationId: string; humanConnectedLabel: string | null };
  source: 'WIDGET' | 'WHATSAPP' | 'DEMO';
  visitorId: string | null;
  handoverState: HandoverState;
  handoverReason: HandoverReason | null;
  handoverRequestedAt: string | null;
  handoverStartedAt: string | null;
  handoverResolvedAt: string | null;
  takenOverBy: { id: string; name: string | null } | null;
  messages: ThreadMessage[];
}

/** List of conversations in the Inbox for the given filter. */
export function useInbox(filter: HandoverFilter) {
  const { isAuthenticated } = useAuth();
  const api = useApiClient();
  return useQuery<InboxItem[]>({
    queryKey: ['handover', 'inbox', filter],
    queryFn: () => api.get(`/handover/inbox?filter=${filter}`),
    enabled: isAuthenticated,
    // Realtime (the org socket in useHandoverRealtime) drives live updates on
    // the Inbox page. This slow poll is only a reconcile backstop + the sidebar
    // badge's sole source on non-Inbox pages (where no socket is mounted).
    refetchInterval: 30_000,
  });
}

/** Count of conversations waiting for a human — powers the sidebar flag. */
export function useInboxCount(): number {
  const { data } = useInbox('needs');
  return data?.length ?? 0;
}

/**
 * Whether ANY in-scope bot has human takeover enabled. Drives the Inbox page's
 * empty state — if every bot is bot-only, there's nothing to handle here.
 * `isResolved` is false until the check returns, so the page can hold off on
 * the empty state instead of flashing it during load.
 */
export function useHandoverEnabled(): { enabled: boolean; isResolved: boolean } {
  const { isAuthenticated } = useAuth();
  const api = useApiClient();
  const { data, isSuccess } = useQuery<{ enabled: boolean }>({
    queryKey: ['handover', 'enabled'],
    queryFn: () => api.get('/handover/enabled'),
    enabled: isAuthenticated,
    // Short so toggling takeover on an agent reflects here without a hard reload.
    staleTime: 15_000,
  });
  return { enabled: data?.enabled ?? false, isResolved: isSuccess };
}

export function useThread(sessionId: string | null | undefined) {
  const { isAuthenticated } = useAuth();
  const api = useApiClient();
  return useQuery<HandoverThread>({
    queryKey: ['handover', 'thread', sessionId],
    queryFn: () => api.get(`/handover/${sessionId}`),
    enabled: isAuthenticated && !!sessionId,
    // The open thread updates live over the session-room socket (see the thread
    // pane's onSessionPing). This slow poll is just a reconcile backstop.
    refetchInterval: 30_000,
  });
}

export function useTakeover() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api.post(`/handover/${sessionId}/takeover`),
    onSuccess: (data: HandoverThread, sessionId) => {
      qc.setQueryData(['handover', 'thread', sessionId], data);
      qc.invalidateQueries({ queryKey: ['handover', 'inbox'] });
    },
  });
}

export function useResolveHandover() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api.post(`/handover/${sessionId}/resolve`),
    onSuccess: (data: HandoverThread, sessionId) => {
      qc.setQueryData(['handover', 'thread', sessionId], data);
      qc.invalidateQueries({ queryKey: ['handover', 'inbox'] });
    },
  });
}

export function useSendHumanMessage() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, content }: { sessionId: string; content: string }) =>
      api.post(`/handover/${sessionId}/messages`, { content }),
    onSuccess: (_data, { sessionId }) => {
      qc.invalidateQueries({ queryKey: ['handover', 'thread', sessionId] });
      qc.invalidateQueries({ queryKey: ['handover', 'inbox'] });
    },
  });
}

/**
 * Live Inbox updates over the self-hosted Socket.io handover gateway (replaces
 * Supabase Realtime). Scoped to the logged-in user — a CLIENT gets their org
 * room, a SUPER_ADMIN/ADMIN gets the platform room (all orgs) — so the flag
 * lights up instantly for everyone, not just org-bound users. Pings are
 * content-free; the hooks re-fetch from the authed API. A React Query poll
 * stays as the safety net if the socket can't connect.
 */
export function useHandoverRealtime(
  profile: { role?: string; organization?: { id?: string | null } | null } | null | undefined,
) {
  const qc = useQueryClient();
  const orgId = profile?.organization?.id ?? undefined;
  const role = profile?.role;

  useEffect(() => {
    const auth = profileHandoverAuth({ role, organization: orgId ? { id: orgId } : null });
    if (!auth) return;
    const socket = ensureHandoverSocket(auth);

    // Coalesce bursts: one event can reach this socket via several rooms
    // (org/platform + a watched session), so debounce into a SINGLE refetch of
    // the active handover queries instead of one request per delivery.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refetchSoon = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        qc.invalidateQueries({ queryKey: ['handover'] });
      }, 300);
    };

    socket.on('handover', refetchSoon);
    socket.on('message', refetchSoon);
    return () => {
      socket.off('handover', refetchSoon);
      socket.off('message', refetchSoon);
      if (timer) clearTimeout(timer);
    };
  }, [orgId, role, qc]);
}
