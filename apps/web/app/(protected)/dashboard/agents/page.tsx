'use client';

import { useProfile } from '@/hooks/use-profile';
import { AgentsDataTable } from '@/components/features/agents/agents-data-table';
import { CreateAgentDialog } from '@/components/features/agents/create-agent-dialog';

export default function AgentsPage() {
  const { profile, isLoading } = useProfile();

  if (isLoading) {
    return null;
  }

  const isAdmin =
    profile?.role === 'SUPER_ADMIN' || profile?.role === 'ADMIN';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
          <p className="text-muted-foreground">
            Manage and configure your chat agents.
          </p>
        </div>
        {isAdmin && <CreateAgentDialog />}
      </div>

      <AgentsDataTable
        emptyAction={isAdmin ? <CreateAgentDialog /> : undefined}
      />
    </div>
  );
}
