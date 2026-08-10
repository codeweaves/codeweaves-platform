'use client';

import { useEffect } from 'react';
import { usePermissions } from '@/hooks/use-permissions';
import { usePageHeader } from '@/components/layout/page-header';
import { AgentsDataTable } from '@/components/features/agents/agents-data-table';
import { CreateAgentDialog } from '@/components/features/agents/create-agent-dialog';

export default function AgentsPage() {
  const { can, isLoading } = usePermissions();
  const { setTitle, setActions } = usePageHeader();

  // Only the create affordance is gated here; listing is gated by the API.
  const isAdmin = can('Agent:Create');

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
