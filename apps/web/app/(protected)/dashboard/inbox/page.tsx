'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePageHeader } from '@/components/layout/page-header';
import { InboxView } from '@/components/features/handover/inbox-view';
import { useNotificationById } from '@/hooks/use-notifications';

/**
 * Swaps a `?n=<notificationId>` deep link (the form notification emails carry)
 * for the `?session=` form the Inbox actually selects on.
 *
 * The indirection is deliberate: a `publicSessionId` is a bearer credential for
 * the public chat endpoints, so it must never travel in an email. A notification
 * id grants nothing without a login, and this resolution runs behind auth.
 *
 * Renders nothing — it only rewrites the URL, then the normal Inbox takes over.
 */
function NotificationDeepLinkResolver({ notificationId }: { notificationId: string }) {
  const router = useRouter();
  const { data, isError } = useNotificationById(notificationId);

  useEffect(() => {
    // Unknown id, or another org's notification → just show the Inbox.
    if (isError) {
      router.replace('/dashboard/inbox', { scroll: false });
      return;
    }
    if (!data) return;
    router.replace(
      data.entityType === 'conversation' && data.entityId
        ? `/dashboard/inbox?session=${encodeURIComponent(data.entityId)}`
        : '/dashboard/inbox',
      { scroll: false },
    );
  }, [data, isError, router]);

  return null;
}

function InboxPageInner() {
  const searchParams = useSearchParams();
  const selectedSessionId = searchParams.get('session');
  const notificationId = searchParams.get('n');
  const { setTitle } = usePageHeader();

  useEffect(() => {
    setTitle('Inbox');
    return () => setTitle('');
  }, [setTitle]);

  return (
    <>
      {notificationId && !selectedSessionId && (
        <NotificationDeepLinkResolver notificationId={notificationId} />
      )}
      <InboxView selectedSessionId={selectedSessionId} />
    </>
  );
}

export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <InboxPageInner />
    </Suspense>
  );
}
