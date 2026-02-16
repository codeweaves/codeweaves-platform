'use client';

import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useProfile } from '@/hooks/use-profile';
import { OrganizationsDataTable } from '@/components/features/organizations/organizations-data-table';
import { CreateOrganizationDialog } from '@/components/features/organizations/create-organization-dialog';
import { Skeleton } from '@/components/ui/skeleton';

export default function OrganizationsPage() {
  const router = useRouter();
  const { profile, isLoading } = useProfile();

  useEffect(() => {
    if (!isLoading && profile?.role === 'CLIENT') {
      router.replace('/dashboard');
    }
  }, [isLoading, profile, router]);

  if (isLoading || profile?.role === 'CLIENT') {
    return null;
  }

  const isSuperAdmin = profile?.role === 'SUPER_ADMIN';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Organizations</h1>
          <p className="text-muted-foreground">
            Manage and monitor all organizations on the platform.
          </p>
        </div>
        {isSuperAdmin && <CreateOrganizationDialog />}
      </div>

      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <OrganizationsDataTable
          emptyAction={isSuperAdmin ? <CreateOrganizationDialog /> : undefined}
        />
      </Suspense>
    </div>
  );
}
