'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePermissions } from '@/hooks/use-permissions';
import { usePageHeader } from '@/components/layout/page-header';
import { OrganizationsDataTable } from '@/components/features/organizations/organizations-data-table';
import { CreateOrganizationDialog } from '@/components/features/organizations/create-organization-dialog';

export default function OrganizationsPage() {
  const router = useRouter();
  const { can, isLoading } = usePermissions();
  const { setTitle, setActions } = usePageHeader();

  const isSuperAdmin = can('Organization:Create');

  useEffect(() => {
    if (!isLoading && !can('Organization:ReadAll')) {
      router.replace('/dashboard');
    }
  }, [isLoading, can, router]);

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

  if (isLoading || !can('Organization:ReadAll')) {
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
