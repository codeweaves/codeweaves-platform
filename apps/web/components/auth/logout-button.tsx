'use client';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';

export function LogoutButton() {
  const { logout, isLoading } = useAuth();

  return (
    <Button
      variant="ghost"
      onClick={logout}
      disabled={isLoading}
    >
      Log Out
    </Button>
  );
}
