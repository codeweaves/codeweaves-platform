'use client';

import { useEffect } from 'react';
import { usePageHeader } from '@/components/layout/page-header';
import { ConversationsView } from '@/components/features/conversations/conversations-view';

export default function ConversationsPage() {
  const { setTitle } = usePageHeader();

  useEffect(() => {
    setTitle('Conversations');
    return () => setTitle('');
  }, [setTitle]);

  return <ConversationsView selectedSessionId={null} />;
}
