'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useProfile } from '@/hooks/use-profile';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { TeamMembersList } from '@/components/features/team/team-members-list';
import { PendingInvitationsList } from '@/components/features/team/pending-invitations-list';
import { InviteMemberDialog } from '@/components/features/team/invite-member-dialog';

export default function TeamPage() {
  const router = useRouter();
  const { profile, isLoading } = useProfile();
  const { organization } = useCurrentOrganization();
  const isSuperAdmin = profile?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (!isLoading && profile?.role === 'CLIENT') {
      router.replace('/dashboard');
    }
  }, [isLoading, profile, router]);

  if (isLoading || profile?.role === 'CLIENT') {
    return null;
  }

  const subtitle = organization
    ? `Manage team members and invitations for ${organization.name}.`
    : 'Manage invitations across all organizations.';

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team</h1>
          <p className="text-muted-foreground">{subtitle}</p>
        </div>
        {(organization || isSuperAdmin) && <InviteMemberDialog />}
      </div>

      {organization && <TeamMembersList />}
      <PendingInvitationsList />
    </div>
  );
}
