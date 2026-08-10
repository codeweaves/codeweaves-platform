'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePermissions } from '@/hooks/use-permissions';
import { usePageHeader } from '@/components/layout/page-header';
import { EmailTemplateEditor } from '@/components/features/email-templates/email-template-editor';

/**
 * Utilities → Email: edit transactional email copy without a deploy.
 *
 * SUPER_ADMIN only. The client-side redirect is UX, not the security boundary —
 * the API enforces the role on every route (`@Roles(Role.SUPER_ADMIN)`), so a
 * user who reaches this URL directly still gets 403s from the data layer.
 */
export default function UtilitiesEmailPage() {
  const router = useRouter();
  const { can, isLoading } = usePermissions();
  const { setTitle } = usePageHeader();
  const isSuperAdmin = can('EmailTemplate:Update');

  useEffect(() => {
    if (!isLoading && !isSuperAdmin) {
      router.replace('/dashboard');
    }
  }, [isLoading, isSuperAdmin, router]);

  useEffect(() => {
    setTitle('Email Templates');
    return () => setTitle('');
  }, [setTitle]);

  if (isLoading || !isSuperAdmin) return null;

  return <EmailTemplateEditor />;
}
