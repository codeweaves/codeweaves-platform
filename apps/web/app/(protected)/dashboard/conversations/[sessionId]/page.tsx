'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

/**
 * Legacy redirect — early versions used a dynamic /conversations/[sessionId]
 * route, but that forced a full page remount on each row click (which reset
 * filter state and felt slow). The canonical URL is now
 * /conversations?session=<sessionId>, served by the parent page; this file
 * just bounces any old bookmarks over with `router.replace`.
 */
export default function ConversationLegacyRedirect() {
  const params = useParams<{ sessionId: string }>();
  const router = useRouter();

  useEffect(() => {
    if (!params.sessionId) {
      router.replace('/dashboard/conversations');
      return;
    }
    router.replace(
      `/dashboard/conversations?session=${encodeURIComponent(params.sessionId)}`,
    );
  }, [params.sessionId, router]);

  return null;
}
