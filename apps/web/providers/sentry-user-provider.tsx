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
        role: profile?.role,
      });
    } else {
      Sentry.setUser(null);
    }
  }, [user, profile]);

  return <>{children}</>;
}
