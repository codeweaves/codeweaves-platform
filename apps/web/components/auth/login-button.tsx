'use client';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';

export function LoginButton() {
  const { login, isLoading } = useAuth();

  return (
    <Button
      onClick={() => login()}
      disabled={isLoading}
    >
      {isLoading ? 'Loading...' : 'Log In'}
    </Button>
  );
}
