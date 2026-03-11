'use client';

import * as Sentry from '@sentry/nextjs';
import { useAuth0 } from '@auth0/auth0-react';
import { useProfile } from '@/hooks/use-profile';
import { ReactNode, useEffect } from 'react';

export function SentryUserProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth0();
  const { profile } = useProfile();

  useEffect(() => {
    if (user) {
      Sentry.setUser({
        id: user.sub,
        email: user.email,
        role: profile?.role,
      });
    } else {
      Sentry.setUser(null);
    }
  }, [user, profile]);

  return <>{children}</>;
}
