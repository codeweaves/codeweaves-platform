'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, Languages } from 'lucide-react';
import { BreakdownBars } from './breakdown-bars';
import { languageLabel } from './language-labels';
import type { ConversationLanguagesResponse } from '@/hooks/use-analytics';

interface ConversationLanguagesChartProps {
  data?: ConversationLanguagesResponse;
  isLoading: boolean;
  isError?: boolean;
  className?: string;
}

export function ConversationLanguagesChart({ data, isLoading, isError, className }: ConversationLanguagesChartProps) {
  const languages = data?.languages ?? [];
  const hasData = languages.length > 0;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <Languages className="size-4 text-muted-foreground" />
          Languages
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
            Failed to load languages
          </div>
        ) : !hasData ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            No language data for this period
          </div>
        ) : (
          <BreakdownBars
            items={languages.map((l) => ({ label: languageLabel(l.language), count: l.count, percentage: l.percentage }))}
          />
        )}
      </CardContent>
    </Card>
  );
}
