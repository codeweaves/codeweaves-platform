'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Clears the React Query cache whenever the active Clerk user changes
 * (sign-in, sign-out, or account switch). Without this, user-scoped queries
 * such as `/auth/users/me` (keyed `['profile']`) stay cached across a soft
 * navigation, so after signing in as a different user the dashboard would show
 * the *previous* user's data until a full page reload.
 *
 * Resetting on the userId transition lets us navigate with the Next.js router
 * (soft nav) instead of forcing a hard `window.location` reload. Renders nothing.
 *
 * We remove only user-scoped queries and deliberately keep `['health']`: it's
 * app-wide infrastructure gating the whole tree via <ApiGate>, and clearing it
 * would flash the "Connecting to server…" screen mid-sign-in.
 */
export function AuthCacheReset() {
  const { isLoaded, userId } = useAuth();
  const queryClient = useQueryClient();
  // `undefined` = not yet observed; we only reset on an actual transition, not
  // on the first resolved value (which would needlessly wipe the initial load).
  const prevUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isLoaded) return;
    if (prevUserId.current !== undefined && prevUserId.current !== userId) {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== 'health',
      });
    }
    prevUserId.current = userId;
  }, [isLoaded, userId, queryClient]);

  return null;
}
