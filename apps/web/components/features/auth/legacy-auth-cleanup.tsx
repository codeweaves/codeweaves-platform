'use client';

import { useEffect } from 'react';

/**
 * One-time cleanup of stale Auth0 SDK data left in localStorage from before the
 * Clerk migration (`@auth0/auth0-react` used `cacheLocation: "localstorage"`).
 * These keys are inert now — nothing reads them — but we wipe them so migrated
 * users' browsers don't carry dead auth state. Renders nothing.
 */
export function LegacyAuthCleanup() {
  useEffect(() => {
    try {
      for (const key of Object.keys(localStorage)) {
        if (
          key.startsWith('@@auth0spajs@@') ||
          key.toLowerCase().includes('auth0')
        ) {
          localStorage.removeItem(key);
        }
      }
    } catch {
      // localStorage unavailable (SSR/private mode) — nothing to clean.
    }
  }, []);

  return null;
}
