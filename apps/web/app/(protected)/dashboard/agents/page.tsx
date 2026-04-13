'use client';

import { useEffect } from 'react';
import { useProfile } from '@/hooks/use-profile';
import { usePageHeader } from '@/components/layout/page-header';
import { AgentsDataTable } from '@/components/features/agents/agents-data-table';
import { CreateAgentDialog } from '@/components/features/agents/create-agent-dialog';

export default function AgentsPage() {
  const { profile, isLoading } = useProfile();
  const { setTitle, setActions } = usePageHeader();

  const isAdmin =
    profile?.role === 'SUPER_ADMIN' || profile?.role === 'ADMIN';

  useEffect(() => {
    setTitle('Agents');
    return () => setTitle('');
  }, [setTitle]);

  useEffect(() => {
    if (isAdmin) {
      setActions(<CreateAgentDialog />);
    }
    return () => setActions(null);
  }, [isAdmin, setActions]);

  if (isLoading) {
    return null;
  }

  return (
    <div className="space-y-6">
      <AgentsDataTable
        emptyAction={isAdmin ? <CreateAgentDialog /> : undefined}
      />
    </div>
  );
}
