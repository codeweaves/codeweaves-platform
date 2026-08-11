'use client';

import * as Sentry from '@sentry/nextjs';
import { useUser } from '@clerk/nextjs';
import { useProfile } from '@/hooks/use-profile';
import { ReactNode, useEffect } from 'react';

export function SentryUserProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const { profile } = useProfile();

  useEffect(() => {
    if (user) {
      Sentry.setUser({
        id: user.id,
        email: user.primaryEmailAddress?.emailAddress,
        // accessScope + the role set, not the deprecated `role` column: this is
        // the pair that actually explains an authorization error in a report.
        accessScope: profile?.accessScope,
        roleKeys: profile?.roleKeys,
      });
    } else {
      Sentry.setUser(null);
    }
  }, [user, profile]);

  return <>{children}</>;
}
