'use client';

import { useEffect } from 'react';
import { usePageHeader } from '@/components/layout/page-header';
import { CollectedDataView } from '@/components/features/collected-data/collected-data-view';

export default function CollectedDataPage() {
  const { setTitle } = usePageHeader();

  useEffect(() => {
    setTitle('Collected Data');
    return () => setTitle('');
  }, [setTitle]);

  return (
    <div className="space-y-6">
      <CollectedDataView />
    </div>
  );
}
