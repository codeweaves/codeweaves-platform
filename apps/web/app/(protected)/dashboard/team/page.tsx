'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { useProfile } from '@/hooks/use-profile';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { TeamMembersList } from '@/components/features/team/team-members-list';
import { PendingInvitationsList } from '@/components/features/team/pending-invitations-list';
import { InviteMemberDialog } from '@/components/features/team/invite-member-dialog';

export default function TeamPage() {
  const router = useRouter();
  const { profile, isLoading } = useProfile();
  const { organization } = useCurrentOrganization();

  useEffect(() => {
    if (!isLoading && profile?.role === 'CLIENT') {
      router.replace('/dashboard');
    }
  }, [isLoading, profile, router]);

  if (isLoading || profile?.role === 'CLIENT') {
    return null;
  }

  // Super Admin without org context
  if (!organization) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team</h1>
          <p className="text-muted-foreground">
            Manage team members and invitations.
          </p>
        </div>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <Building2 className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">No organization selected</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            You are not assigned to an organization. Visit the Organizations page to manage a specific organization&apos;s team.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team</h1>
          <p className="text-muted-foreground">
            Manage team members and invitations for {organization.name}.
          </p>
        </div>
        <InviteMemberDialog />
      </div>

      <TeamMembersList />
      <PendingInvitationsList />
    </div>
  );
}
