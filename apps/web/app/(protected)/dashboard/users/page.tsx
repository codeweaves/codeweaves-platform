'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePageHeader } from '@/components/layout/page-header';
import { usePermissions } from '@/hooks/use-permissions';
import { UsersDataTable } from '@/components/features/users/users-data-table';

/**
 * Manage Users.
 *
 * The redirect below is UX, not the security boundary: `GET /users` requires
 * `User:ReadAll` server-side, so a user who reaches this URL directly gets an
 * empty table and a 403, never data.
 */
export default function UsersPage() {
  const router = useRouter();
  const { can, isLoading } = usePermissions();
  const { setTitle } = usePageHeader();

  const canList = can('User:ReadAll');

  useEffect(() => {
    setTitle('Users');
    return () => setTitle('');
  }, [setTitle]);

  useEffect(() => {
    if (!isLoading && !canList) {
      router.replace('/dashboard');
    }
  }, [isLoading, canList, router]);

  if (isLoading || !canList) return null;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Everyone with an account. Open a person to see and change what they can do.
      </p>
      <UsersDataTable />
    </div>
  );
}
