'use client';

import { ReactNode } from 'react';
import { useHealthCheck } from '@/hooks/use-health-check';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

interface ApiGateProps {
  children: ReactNode;
}

export function ApiGate({ children }: ApiGateProps) {
  const { isReady, isLoading } = useHealthCheck();

  if (isLoading || !isReady) {
    return <LoadingSpinner message="Connecting to server..." />;
  }

  return <>{children}</>;
}
