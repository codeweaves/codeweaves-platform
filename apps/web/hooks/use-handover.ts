'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import {
  ensureHandoverSocket,
  profileHandoverAuth,
  subscribeHandoverConnected,
  getHandoverConnected,
} from '@/lib/handover-socket';

/**
 * Live handover-socket connection state. While `true`, the Inbox/thread queries
 * pause their 30s poll and rely on socket pushes; while `false` (socket down or
 * not yet connected) they poll as the real fallback. SSR snapshot is `false`.
 */
export function useHandoverSocketConnected(): boolean {
  return useSyncExternalStore(
    subscribeHandoverConnected,
    getHandoverConnected,
    () => false,
  );
}

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
  const socketConnected = useHandoverSocketConnected();
  const api = useApiClient();
  return useQuery<InboxItem[]>({
    queryKey: ['handover', 'inbox', filter],
    queryFn: () => api.get(`/handover/inbox?filter=${filter}`),
    enabled: isAuthenticated,
    // Realtime (the org socket in useHandoverRealtime) drives live updates and
    // fires a catch-up refetch on reconnect. So we ONLY poll when the socket is
    // down — polling alongside a healthy socket is redundant load (and floods
    // logs at scale). Socket up → no interval; socket down → 30s fallback.
    refetchInterval: socketConnected ? false : 30_000,
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
  const socketConnected = useHandoverSocketConnected();
  const api = useApiClient();
  return useQuery<HandoverThread>({
    queryKey: ['handover', 'thread', sessionId],
    queryFn: () => api.get(`/handover/${sessionId}`),
    enabled: isAuthenticated && !!sessionId,
    // Live over the session-room socket + catch-up on reconnect. Poll ONLY when
    // the socket is down (see useInbox for the rationale).
    refetchInterval: socketConnected ? false : 30_000,
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
    // A rejected takeover almost always means a teammate claimed it while this
    // view was stale. Refetch so the pane immediately shows who holds it, rather
    // than leaving a "Take over" button that keeps failing.
    onError: (_err, sessionId) => {
      qc.invalidateQueries({ queryKey: ['handover', 'thread', sessionId] });
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
    // Same reasoning as useTakeover: a rejection means this view was stale about
    // who owns the chat, so re-sync rather than leaving a failing button.
    onError: (_err, sessionId) => {
      qc.invalidateQueries({ queryKey: ['handover', 'thread', sessionId] });
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
    // Optimistic update: show the teammate's own message the instant they hit
    // send, instead of waiting for the POST + a full thread refetch to round-trip
    // (two hops to a possibly-distant backend — felt like 7-8s / "message lost").
    onMutate: async ({ sessionId, content }) => {
      // Stop any in-flight thread fetch (poll/socket refetch) from clobbering
      // the optimistic write between now and when the POST settles.
      await qc.cancelQueries({ queryKey: ['handover', 'thread', sessionId] });
      const previous = qc.getQueryData<HandoverThread>(['handover', 'thread', sessionId]);
      if (previous) {
        const optimistic: ThreadMessage = {
          id: `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          role: 'HUMAN_AGENT',
          content,
          createdAt: new Date().toISOString(),
          author: null, // renders as "You" in the thread pane
        };
        qc.setQueryData<HandoverThread>(['handover', 'thread', sessionId], {
          ...previous,
          messages: [...previous.messages, optimistic],
        });
      }
      return { previous };
    },
    onError: (_err, { sessionId }, context) => {
      // Send failed — roll the thread back so the un-delivered bubble disappears.
      if (context?.previous) {
        qc.setQueryData(['handover', 'thread', sessionId], context.previous);
      }
    },
    onSuccess: () => {
      // Inbox preview/last-message changes on a successful send.
      qc.invalidateQueries({ queryKey: ['handover', 'inbox'] });
    },
    onSettled: (_data, _err, { sessionId }) => {
      // Reconcile with the server copy — swaps the optimistic bubble for the real
      // persisted message (or confirms the rollback). Runs in the background; the
      // sender already saw their message instantly via onMutate.
      qc.invalidateQueries({ queryKey: ['handover', 'thread', sessionId] });
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
  profile:
    | { accessScope?: string; organization?: { id?: string | null } | null }
    | null
    | undefined,
) {
  const qc = useQueryClient();
  const { getToken } = useAuth();
  const orgId = profile?.organization?.id ?? undefined;
  const accessScope = profile?.accessScope;

  useEffect(() => {
    const auth = profileHandoverAuth({ accessScope, organization: orgId ? { id: orgId } : null });
    if (!auth) return;
    // The gateway authenticates the socket with a verified Clerk token; `auth`
    // here is only the client-side scope hint for the singleton key.
    const socket = ensureHandoverSocket(auth, getToken);

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

    // On (re)connect, do one catch-up refetch — this reconciles anything that
    // changed while the socket was down, which is what lets us safely stop the
    // 30s poll while connected (see useInbox/useThread refetchInterval).
    socket.on('connect', refetchSoon);
    socket.on('handover', refetchSoon);
    socket.on('message', refetchSoon);
    return () => {
      socket.off('connect', refetchSoon);
      socket.off('handover', refetchSoon);
      socket.off('message', refetchSoon);
      if (timer) clearTimeout(timer);
    };
  }, [orgId, accessScope, qc, getToken]);
}
