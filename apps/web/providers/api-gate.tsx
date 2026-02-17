'use client';

import { ReactNode } from 'react';
import { useHealthCheck } from '@/hooks/use-health-check';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { ErrorDisplay } from '@/components/ui/error-display';

interface ApiGateProps {
  children: ReactNode;
}

export function ApiGate({ children }: ApiGateProps) {
  const { isReady, isLoading, error, refetch } = useHealthCheck();

  if (isLoading) {
    return <LoadingSpinner message="Connecting to server..." />;
  }

  if (error || !isReady) {
    return (
      <ErrorDisplay
        title="Server unavailable"
        message="Unable to connect to the server. Please check that the backend is running and try again."
        onRetry={() => refetch()}
      />
    );
  }

  return <>{children}</>;
}
