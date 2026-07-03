'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePageHeader } from '@/components/layout/page-header';
import { InboxView } from '@/components/features/handover/inbox-view';

function InboxPageInner() {
  const searchParams = useSearchParams();
  const selectedSessionId = searchParams.get('session');
  const { setTitle } = usePageHeader();

  useEffect(() => {
    setTitle('Inbox');
    return () => setTitle('');
  }, [setTitle]);

  return <InboxView selectedSessionId={selectedSessionId} />;
}

export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <InboxPageInner />
    </Suspense>
  );
}
