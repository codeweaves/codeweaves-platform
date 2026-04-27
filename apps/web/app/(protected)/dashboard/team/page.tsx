'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useProfile } from '@/hooks/use-profile';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { usePageHeader } from '@/components/layout/page-header';
import { TeamMembersList } from '@/components/features/team/team-members-list';
import { PendingInvitationsList } from '@/components/features/team/pending-invitations-list';
import { InviteMemberDialog } from '@/components/features/team/invite-member-dialog';

export default function TeamPage() {
  const router = useRouter();
  const { profile, isLoading } = useProfile();
  const { organization } = useCurrentOrganization();
  const { setTitle, setActions } = usePageHeader();
  const isSuperAdmin = profile?.role === 'SUPER_ADMIN';
  const canInvite = !!(organization || isSuperAdmin);

  useEffect(() => {
    if (!isLoading && profile?.role === 'CLIENT') {
      router.replace('/dashboard');
    }
  }, [isLoading, profile, router]);

  // Match the agents page layout: title + primary action live in the global
  // page header so they sit at the very top of the chrome.
  useEffect(() => {
    setTitle('Team');
    return () => setTitle('');
  }, [setTitle]);

  useEffect(() => {
    if (canInvite) {
      setActions(<InviteMemberDialog />);
    }
    return () => setActions(null);
  }, [canInvite, setActions]);

  if (isLoading || profile?.role === 'CLIENT') {
    return null;
  }

  return (
    <div className="space-y-8">
      {organization && <TeamMembersList />}
      <PendingInvitationsList />
    </div>
  );
}
