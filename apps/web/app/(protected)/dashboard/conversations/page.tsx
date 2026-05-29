'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePageHeader } from '@/components/layout/page-header';
import { ConversationsView } from '@/components/features/conversations/conversations-view';

function ConversationsPageInner() {
  const searchParams = useSearchParams();
  // Selected session is driven by the URL search param — survives reloads,
  // is shareable, and keeps the ConversationsView component mounted across
  // selection changes (so filter state is preserved on row clicks).
  const selectedSessionId = searchParams.get('session');
  const { setTitle } = usePageHeader();

  useEffect(() => {
    setTitle('Conversations');
    return () => setTitle('');
  }, [setTitle]);

  return <ConversationsView selectedSessionId={selectedSessionId} />;
}

export default function ConversationsPage() {
  // useSearchParams requires a Suspense boundary in the app router so the
  // outer shell can stream while the search-param hook resolves.
  return (
    <Suspense fallback={null}>
      <ConversationsPageInner />
    </Suspense>
  );
}
