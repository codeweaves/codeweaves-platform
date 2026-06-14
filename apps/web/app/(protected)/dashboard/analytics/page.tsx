import { Suspense } from 'react';
import {
  AnalyticsPageClient,
  AnalyticsPageSkeleton,
} from '@/components/features/analytics/analytics-page-client';

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<AnalyticsPageSkeleton />}>
      <AnalyticsPageClient />
    </Suspense>
  );
}
