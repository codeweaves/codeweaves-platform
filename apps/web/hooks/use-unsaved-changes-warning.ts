'use client';

import { useEffect, useRef } from 'react';

/**
 * Warns users about unsaved changes on browser tab close/refresh (beforeunload)
 * and browser back/forward navigation (popstate).
 *
 * NOTE: Next.js App Router client-side navigation via `<Link>` or `router.push()`
 * bypasses the popstate event and cannot be intercepted by this hook. Those
 * navigations are only guarded by the beforeunload event (which fires on full
 * page unloads, not SPA transitions). This is a known limitation of the App
 * Router — there is no stable public API for route-change interception.
 */
export function useUnsavedChangesWarning(isDirty: boolean) {
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const historyPushedRef = useRef(false);

  // Browser tab close / refresh
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        e.preventDefault();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Back / forward navigation — only push sentinel state when dirty
  useEffect(() => {
    if (isDirty && !historyPushedRef.current) {
      window.history.pushState({ unsavedGuard: true }, '', window.location.href);
      historyPushedRef.current = true;
    }

    if (!isDirty && historyPushedRef.current) {
      // Clean up sentinel state when no longer dirty
      historyPushedRef.current = false;
    }
  }, [isDirty]);

  useEffect(() => {
    const handlePopState = () => {
      if (isDirtyRef.current) {
        const leave = window.confirm(
          'You have unsaved changes. Are you sure you want to leave?',
        );
        if (!leave) {
          window.history.pushState({ unsavedGuard: true }, '', window.location.href);
        } else {
          historyPushedRef.current = false;
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
}
