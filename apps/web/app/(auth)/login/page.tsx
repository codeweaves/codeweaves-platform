'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

export default function LoginPage() {
  const { isAuthenticated, isLoading, login } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return <LoadingSpinner message="Loading..." />;
  }

  if (isAuthenticated) {
    return <LoadingSpinner message="Redirecting..." />;
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center">
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold">Klivo</h1>
        <p className="mt-2 text-muted-foreground">AI Chat Widget Platform</p>
      </div>
      <Button onClick={() => login()} size="lg" className="cursor-pointer">
        Log In
      </Button>
    </div>
  );
}
