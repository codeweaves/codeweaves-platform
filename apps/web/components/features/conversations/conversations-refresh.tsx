'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * How often the Conversations page re-fetches on its own.
 *
 * 60s, the same cadence and tab-visibility gate the Analytics page uses, so the
 * two dashboards behave identically. A poll rather than a socket subscription
 * because this page is a historical browser over a filtered, paginated query,
 * not a room: no server-side event maps cleanly onto "your current filter set
 * changed". Polling stops whenever the tab is hidden, so an abandoned tab costs
 * nothing, and the queries catch up on focus when it comes back.
 */
export const CONVERSATIONS_POLL_MS = 60_000;

/** Every query on this page lives under this prefix, list and transcript alike. */
const CONVERSATIONS_KEY = ['conversations'];

/**
 * Floor on the spin.
 *
 * A warm refetch can land in under 100ms, which is faster than the eye resolves
 * — the user clicks and, to them, nothing happened. Holding the spinner for a
 * beat makes the action legible without misrepresenting anything: the data is
 * already refreshed, we are only finishing the animation.
 */
const MIN_SPIN_MS = 500;

/** How long the "Refreshed" tick sticks around. Matches EmbedCodeDialog's copy button. */
const CONFIRMATION_MS = 2000;

/**
 * Manual refresh for the whole Conversations page.
 *
 * Invalidates the shared prefix rather than calling one pane's `refetch`, so a
 * single click refreshes the list AND the open transcript. Filters, page and
 * page size all survive: refresh re-runs what you are looking at, it does not
 * reset the view.
 *
 * Deliberately no "Updated 2m ago" label, unlike the Collected Data table. A
 * timestamp and auto-refresh are substitutes: with a 60s poll the age is
 * bounded and the label can only ever read "just now", so it adds noise while
 * implying the data might be older than it is. Dashboards that poll (Grafana,
 * Datadog) show the interval instead — here that lives in the tooltip.
 *
 * The acknowledgement is a spin followed by a brief tick, the same pattern as
 * the copy buttons elsewhere, and for the same reason: a refresh over unchanged
 * data has NO visible result, so the button has to be the receipt.
 */
export function ConversationsRefreshButton({
  className,
}: {
  className?: string;
}) {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  // A counter, not a boolean: clicking again mid-confirmation restarts the
  // timer rather than being swallowed as "already true".
  const [confirmedAt, setConfirmedAt] = useState(0);

  useEffect(() => {
    if (!confirmedAt) return;
    const id = setTimeout(() => setConfirmedAt(0), CONFIRMATION_MS);
    return () => clearTimeout(id);
  }, [confirmedAt]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        // Default refetchType 'active' — cached pages the user is not looking
        // at are marked stale and re-fetched only if they come back on screen.
        queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY }),
        new Promise((resolve) => setTimeout(resolve, MIN_SPIN_MS)),
      ]);
      // Only now: the tick means "new data is on screen", not "a request went out".
      setConfirmedAt((n) => n + 1);
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient]);

  const confirmed = confirmedAt > 0;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRefresh}
      // Only the user's own refresh disables the button. The 60s poll stays
      // invisible; a background poll that greys out a control is not a
      // background poll.
      disabled={isRefreshing}
      // Fixed width so swapping "Refresh" for "Refreshed" does not nudge the
      // filter bar. Sized to the longer label so neither state looks padded out.
      className={cn('w-25 justify-center px-2.5', className)}
      title={`Refresh now. Updates automatically every ${CONVERSATIONS_POLL_MS / 1000}s.`}
    >
      {/* No margin — Button owns the icon-to-label gap. */}
      {confirmed ? (
        <Check className="size-4 text-green-500" />
      ) : (
        <RefreshCw className={cn('size-4', isRefreshing && 'animate-spin')} />
      )}
      {/* Announced to screen readers, which get no signal from the icon swap. */}
      <span aria-live="polite">{confirmed ? 'Refreshed' : 'Refresh'}</span>
    </Button>
  );
}
