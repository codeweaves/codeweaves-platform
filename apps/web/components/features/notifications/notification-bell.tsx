'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { Bell, BellOff, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  notificationHref,
  useMarkNotificationRead,
  useMarkNotificationsSeen,
  useNotifications,
  useNotificationSound,
  useUnreadCount,
  type NotificationItem,
} from '@/hooks/use-notifications';
import {
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  type BrowserNotificationPermission,
} from '@/lib/browser-notification';

/**
 * The notification bell + panel.
 *
 * The badge is a cursor-based count ("since you last opened this"), so opening
 * the panel clears it in one write rather than marking N items read. Individual
 * items still track their own read state, which is what dims them in the list.
 */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const { data, isLoading } = useNotifications();
  const markSeen = useMarkNotificationsSeen();
  const markRead = useMarkNotificationRead();
  const { enabled: soundEnabled, setEnabled: setSoundEnabled } = useNotificationSound();

  // Read lazily rather than in state: the permission can change from the
  // browser's own UI while the app is open, and this is only read on render.
  const [permission, setPermission] = useState<BrowserNotificationPermission>(() =>
    getBrowserNotificationPermission(),
  );

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      // Clear the badge as soon as the panel opens — that IS "seen".
      if (next && unread > 0) markSeen.mutate();
      if (next) setPermission(getBrowserNotificationPermission());
    },
    [unread, markSeen],
  );

  const onItemClick = useCallback(
    (n: NotificationItem) => {
      if (!n.read) markRead.mutate(n.id);
      setOpen(false);
      router.push(notificationHref(n));
    },
    [markRead, router],
  );

  const onEnableBrowserNotifications = useCallback(async () => {
    // Called from a click — the only place the browser will honour the prompt
    // without penalising us.
    setPermission(await requestBrowserNotificationPermission());
  }, []);

  const items = data?.items ?? [];

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-foreground [&_svg]:size-4.5"
          aria-label={
            unread
              ? `Notifications: ${unread} new`
              : 'Notifications'
          }
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground tabular-nums ring-2 ring-background">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={8} className="w-90 p-0">
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-sm font-semibold">Notifications</span>
          {/* Radix requires a TooltipProvider ancestor or Root throws. There is
              no global one in this app — every call site wraps locally. */}
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-foreground [&_svg]:size-4"
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  aria-label={
                    soundEnabled ? 'Mute notification sound' : 'Unmute notification sound'
                  }
                >
                  {soundEnabled ? <Volume2 /> : <VolumeX />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {soundEnabled ? 'Sound on (this device)' : 'Sound off (this device)'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <Separator />

        {/* Ask for browser-notification permission ONLY from this explicit
            click. Never on page load — a reflex "Block" is permanent. */}
        {permission === 'default' && (
          <>
            <div className="flex items-start gap-2.5 bg-muted/40 px-3 py-2.5">
              <BellOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-snug text-muted-foreground">
                  Get a popup when a visitor asks for a human, even when this tab
                  is in the background.
                </p>
                <Button
                  variant="link"
                  className="h-auto p-0 text-xs font-semibold"
                  onClick={() => void onEnableBrowserNotifications()}
                >
                  Enable browser notifications
                </Button>
              </div>
            </div>
            <Separator />
          </>
        )}

        <div className="thin-scroll max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              Nothing yet. You&apos;ll be notified here when a visitor asks for a
              human.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onItemClick(n)}
                    className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mt-1.5 size-2 shrink-0 rounded-full',
                        n.read
                          ? 'bg-transparent'
                          : n.severity === 'URGENT'
                            ? 'bg-destructive'
                            : 'bg-primary',
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block text-xs leading-snug',
                          n.read ? 'text-muted-foreground' : 'font-medium text-foreground',
                        )}
                      >
                        {n.title}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground/70">
                        {formatRelative(n.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** "3 minutes ago" — tolerant of a malformed timestamp so the panel can't crash
 *  on one bad row. */
function formatRelative(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return formatDistanceToNow(date, { addSuffix: true });
}
