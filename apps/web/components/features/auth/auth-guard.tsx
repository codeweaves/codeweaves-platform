'use client';

import { useAuth } from '@/hooks/use-auth';
import { useProfile } from '@/hooks/use-profile';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();
  const { profile, isLoading: profileLoading } = useProfile();
  const pathname = usePathname();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      login(pathname);
    }
  }, [authLoading, isAuthenticated, login, pathname]);

  if (authLoading) {
    return <LoadingSpinner message="Loading..." />;
  }

  if (!isAuthenticated) {
    return <LoadingSpinner message="Redirecting to login..." />;
  }

  // Wait for profile to load from backend before rendering the dashboard
  if (profileLoading || !profile) {
    return <LoadingSpinner message="Loading profile..." />;
  }

  return <>{children}</>;
}
