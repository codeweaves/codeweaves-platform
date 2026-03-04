import { Suspense } from 'react';
import { AnalyticsPageClient } from '@/components/features/analytics/analytics-page-client';

export default function AnalyticsPage() {
  return (
    <Suspense>
      <AnalyticsPageClient />
    </Suspense>
  );
}
