'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { useHandoverSocketConnected } from '@/hooks/use-handover';
import {
  ensureHandoverSocket,
  profileHandoverAuth,
} from '@/lib/handover-socket';
import {
  getSoundEnabled,
  playNotificationSound,
  primeNotificationSound,
  setSoundEnabled,
  subscribeSoundEnabled,
} from '@/lib/notification-sound';
import { showBrowserNotification } from '@/lib/browser-notification';

export type NotificationType = 'HANDOVER_REQUESTED';
export type NotificationSeverity = 'INFO' | 'URGENT';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  read: boolean;
}

interface NotificationPage {
  items: NotificationItem[];
  nextCursor: string | null;
}

/** Socket payload — a trimmed notification, enough to render a toast without a
 *  refetch. Body/read state come from the list query. */
interface NotificationPush {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  entityType?: string;
  entityId?: string;
  createdAt: string;
}

/** In-app route for a notification's deep link. */
export function notificationHref(n: {
  entityType?: string | null;
  entityId?: string | null;
}): string {
  if (n.entityType === 'conversation' && n.entityId) {
    return `/dashboard/inbox?session=${encodeURIComponent(n.entityId)}`;
  }
  return '/dashboard/inbox';
}

/**
 * The bell list. Socket pushes keep it live, so this only polls when the socket
 * is down — the same pattern the Inbox queries use.
 */
export function useNotifications() {
  const { isAuthenticated } = useAuth();
  const socketConnected = useHandoverSocketConnected();
  const api = useApiClient();
  return useQuery<NotificationPage>({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.get('/notifications?limit=20'),
    enabled: isAuthenticated,
    refetchInterval: socketConnected ? false : 60_000,
  });
}

/**
 * Resolve one notification by id — backs the `?n=<id>` link that notification
 * emails carry.
 *
 * The email deliberately links by notification id rather than session id: a
 * session id is a bearer credential for the public chat endpoints, so it must
 * never leave an authenticated context, whereas this lookup is authenticated
 * and org-scoped. The Inbox swaps the id for its conversation here.
 */
export function useNotificationById(id: string | null) {
  const { isAuthenticated } = useAuth();
  const api = useApiClient();
  return useQuery<{
    id: string;
    type: NotificationType;
    entityType: string | null;
    entityId: string | null;
  }>({
    queryKey: ['notifications', 'by-id', id],
    queryFn: () => api.get(`/notifications/${id}`),
    enabled: isAuthenticated && !!id,
    // A resolved deep link never changes; don't refetch it on every focus.
    staleTime: Infinity,
    retry: false,
  });
}

/** Badge count. Same polling rationale as the list. */
export function useUnreadCount(): number {
  const { isAuthenticated } = useAuth();
  const socketConnected = useHandoverSocketConnected();
  const api = useApiClient();
  const { data } = useQuery<{ count: number }>({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get('/notifications/unread-count'),
    enabled: isAuthenticated,
    refetchInterval: socketConnected ? false : 60_000,
  });
  return data?.count ?? 0;
}

/** Clear the badge — called when the bell panel opens. */
export function useMarkNotificationsSeen() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/notifications/seen'),
    // Optimistic: the badge should vanish the instant the panel opens, not a
    // round-trip later.
    onMutate: () => {
      qc.setQueryData(['notifications', 'unread-count'], { count: 0 });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
    },
  });
}

/** Mark one item read (on click). */
export function useMarkNotificationRead() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onMutate: (id: string) => {
      qc.setQueryData<NotificationPage>(['notifications', 'list'], (prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((n) => (n.id === id ? { ...n, read: true } : n)),
            }
          : prev,
      );
    },
  });
}

/** Device-local sound preference, wired for React. */
export function useNotificationSound(): {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
} {
  const enabled = useSyncExternalStore(
    subscribeSoundEnabled,
    getSoundEnabled,
    () => false, // SSR: silent
  );
  return { enabled, setEnabled: setSoundEnabled };
}

/**
 * Live notification delivery: one socket listener driving four outputs — cache
 * update (bell), toast, sound, and the browser popup.
 *
 * Mount once, in the dashboard shell. It reuses the existing singleton handover
 * socket rather than opening a second connection.
 */
export function useNotificationRealtime(
  profile: { role?: string; organization?: { id?: string | null } | null } | null | undefined,
) {
  const qc = useQueryClient();
  const router = useRouter();
  const { getToken } = useAuth();
  const orgId = profile?.organization?.id ?? undefined;
  const role = profile?.role;

  // Arm the autoplay unlock as soon as the shell mounts, so the first
  // notification of the session can actually make a sound.
  useEffect(() => {
    primeNotificationSound();
  }, []);

  const navigate = useCallback((url: string) => router.push(url), [router]);

  useEffect(() => {
    const auth = profileHandoverAuth({ role, organization: orgId ? { id: orgId } : null });
    if (!auth) return;
    const socket = ensureHandoverSocket(auth, getToken);

    const onNotification = (payload: NotificationPush) => {
      if (!payload?.id) return;

      // 1. Bell — patch the cache in place instead of refetching. Guard against
      //    the same id arriving twice (a reconnect can redeliver).
      qc.setQueryData<NotificationPage>(['notifications', 'list'], (prev) => {
        if (!prev) return prev;
        if (prev.items.some((n) => n.id === payload.id)) return prev;
        const item: NotificationItem = {
          id: payload.id,
          type: payload.type,
          severity: payload.severity,
          title: payload.title,
          body: null,
          entityType: payload.entityType ?? null,
          entityId: payload.entityId ?? null,
          createdAt: payload.createdAt,
          read: false,
        };
        return { ...prev, items: [item, ...prev.items].slice(0, 20) };
      });
      qc.setQueryData<{ count: number }>(['notifications', 'unread-count'], (prev) => ({
        count: (prev?.count ?? 0) + 1,
      }));

      const href = notificationHref(payload);

      // 2. Toast
      toast(payload.title, {
        action: { label: 'Open', onClick: () => router.push(href) },
      });

      // 3. Sound — internally throttled, respects the device preference, and
      //    stays quiet while the user is already looking at the Inbox.
      const onInbox =
        typeof window !== 'undefined' &&
        window.location.pathname.startsWith('/dashboard/inbox');
      if (typeof document !== 'undefined' && (document.hidden || !onInbox)) {
        playNotificationSound();
      }

      // 4. Browser popup — no-ops unless permission is granted AND the tab is
      //    hidden.
      showBrowserNotification({
        id: payload.id,
        title: payload.title,
        url: href,
        onNavigate: navigate,
      });
    };

    // A reconnect may have missed pushes — reconcile once on connect.
    const onConnect = () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    };

    socket.on('notification', onNotification);
    socket.on('connect', onConnect);
    return () => {
      socket.off('notification', onNotification);
      socket.off('connect', onConnect);
    };
  }, [orgId, role, qc, getToken, router, navigate]);
}
