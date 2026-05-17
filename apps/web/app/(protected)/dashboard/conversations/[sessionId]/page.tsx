'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { usePageHeader } from '@/components/layout/page-header';
import { ConversationsView } from '@/components/features/conversations/conversations-view';

export default function ConversationDetailPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId ? decodeURIComponent(params.sessionId) : null;
  const { setTitle } = usePageHeader();

  useEffect(() => {
    setTitle('Conversations');
    return () => setTitle('');
  }, [setTitle]);

  return <ConversationsView selectedSessionId={sessionId} />;
}
