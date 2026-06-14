'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, Tags } from 'lucide-react';
import { BreakdownBars } from './breakdown-bars';
import type { ConversationCategoriesResponse } from '@/hooks/use-analytics';

interface CategoryBreakdownChartProps {
  data?: ConversationCategoriesResponse;
  isLoading: boolean;
  isError?: boolean;
  className?: string;
}

export function CategoryBreakdownChart({ data, isLoading, isError, className }: CategoryBreakdownChartProps) {
  const categories = data?.categories ?? [];
  const hasData = categories.length > 0;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <Tags className="size-4 text-muted-foreground" />
          Conversation Topics
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex h-48 items-center justify-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            Failed to load categories
          </div>
        ) : !hasData ? (
          <div className="flex h-48 flex-col items-center justify-center text-center text-sm text-muted-foreground">
            <p>No classified conversations yet</p>
            <p className="mt-1 text-xs">
              Set category keywords on an agent to auto-classify its conversations.
            </p>
          </div>
        ) : (
          <BreakdownBars items={categories.map((c) => ({ label: c.category, count: c.count, percentage: c.percentage }))} />
        )}
      </CardContent>
    </Card>
  );
}
