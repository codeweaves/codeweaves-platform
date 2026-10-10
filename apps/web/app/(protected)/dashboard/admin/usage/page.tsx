import { Suspense } from "react";
import {
  UsagePageClient,
  UsagePageSkeleton,
} from "@/components/features/admin-usage/usage-page-client";

/**
 * Platform console: provider usage and cost. Gated in the browser for UX; the
 * API enforces `Usage:Read` (platform-only) on every request.
 */
export default function AdminUsagePage() {
  return (
    <Suspense fallback={<UsagePageSkeleton />}>
      <UsagePageClient />
    </Suspense>
  );
}
