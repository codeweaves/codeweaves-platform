'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useProfile } from '@/hooks/use-profile';
import { usePageHeader } from '@/components/layout/page-header';
import { OrganizationsDataTable } from '@/components/features/organizations/organizations-data-table';
import { CreateOrganizationDialog } from '@/components/features/organizations/create-organization-dialog';

export default function OrganizationsPage() {
  const router = useRouter();
  const { profile, isLoading } = useProfile();
  const { setTitle, setActions } = usePageHeader();

  const isSuperAdmin = profile?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (!isLoading && profile?.role === 'CLIENT') {
      router.replace('/dashboard');
    }
  }, [isLoading, profile, router]);

  useEffect(() => {
    setTitle('Organizations');
    return () => setTitle('');
  }, [setTitle]);

  useEffect(() => {
    if (isSuperAdmin) {
      setActions(<CreateOrganizationDialog />);
    }
    return () => setActions(null);
  }, [isSuperAdmin, setActions]);

  if (isLoading || profile?.role === 'CLIENT') {
    return null;
  }

  return (
    <div className="space-y-6">
      <OrganizationsDataTable
        emptyAction={isSuperAdmin ? <CreateOrganizationDialog /> : undefined}
      />
    </div>
  );
}
