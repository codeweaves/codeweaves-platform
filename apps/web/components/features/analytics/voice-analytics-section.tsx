'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { KpiCard } from './kpi-card';
import { BreakdownBars } from './breakdown-bars';
import { languageLabel } from './language-labels';
import { Mic, Timer, Languages, Activity } from 'lucide-react';
import type {
  AnalyticsParams,
  AnalyticsQueryOptions,
  VoiceSummaryResponse,
  LanguageDistributionResponse,
  VoiceLatencyResponse,
} from '@/hooks/use-analytics';
import {
  useVoiceSummary,
  useLanguageDistribution,
  useVoiceLatency,
} from '@/hooks/use-analytics';

interface VoiceAnalyticsSectionProps {
  params: AnalyticsParams;
  pollingOptions?: AnalyticsQueryOptions;
}

/**
 * Voice analytics content (rendered inside the Voice tab). Language/latency
 * queries stay gated behind `hasVoiceData` so we don't fire them for text-only
 * orgs; when there's no voice data we show a friendly empty state instead.
 */
export function VoiceAnalyticsSection({ params, pollingOptions }: VoiceAnalyticsSectionProps) {
  const summaryQuery = useVoiceSummary(params, pollingOptions);
  const summary = summaryQuery.data;
  const hasVoiceData = !!summary && summary.totalVoiceMessages > 0;

  const languagesQuery = useLanguageDistribution(params, { ...pollingOptions, enabled: hasVoiceData });
  const latencyQuery = useVoiceLatency(params, { ...pollingOptions, enabled: hasVoiceData });

  if (!summaryQuery.isLoading && !hasVoiceData) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Mic className="mb-4 size-12 text-muted-foreground/40" />
          <h3 className="text-lg font-medium">No voice conversations yet</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Enable voice on an agent to see voice volume, languages and provider latency here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <VoiceSummaryCards data={summary} isLoading={summaryQuery.isLoading} />
      <div className="grid gap-6 lg:grid-cols-2">
        <VoiceLanguageCard data={languagesQuery.data} isLoading={languagesQuery.isLoading} />
        <ProviderLatencyTable data={latencyQuery.data} isLoading={latencyQuery.isLoading} />
      </div>
    </div>
  );
}

// --- Voice Summary Cards ---
function VoiceSummaryCards({ data, isLoading }: { data?: VoiceSummaryResponse; isLoading: boolean }) {
  const voiceRatioPercent = data ? `${(data.voiceRatio * 100).toFixed(1)}%` : '0%';

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        title="Voice Messages"
        value={data?.totalVoiceMessages?.toLocaleString() ?? '0'}
        trend={data?.trend.voiceMessagesTrend}
        icon={Mic}
        isLoading={isLoading}
      />
      <KpiCard title="Voice / Text Ratio" value={voiceRatioPercent} icon={Mic} isLoading={isLoading} />
      <KpiCard
        title="Avg STT Latency"
        value={data ? `${data.avgSttLatencyMs}ms` : '0ms'}
        trendInverted
        icon={Timer}
        isLoading={isLoading}
      />
      <KpiCard
        title="Avg TTS Latency"
        value={data ? `${data.avgTtsLatencyMs}ms` : '0ms'}
        trendInverted
        icon={Timer}
        isLoading={isLoading}
      />
    </div>
  );
}

// --- Voice Language Distribution (horizontal bars; replaces pie) ---
function VoiceLanguageCard({ data, isLoading }: { data?: LanguageDistributionResponse; isLoading: boolean }) {
  const languages = data?.languages ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <Languages className="size-4 text-muted-foreground" />
          Voice Languages
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : languages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No language data available</p>
        ) : (
          <BreakdownBars
            items={languages.map((l) => ({ label: languageLabel(l.language), count: l.count, percentage: l.percentage }))}
          />
        )}
      </CardContent>
    </Card>
  );
}

// --- Provider Latency Table ---
function ProviderLatencyTable({ data, isLoading }: { data?: VoiceLatencyResponse; isLoading: boolean }) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader><Skeleton className="h-5 w-40" /></CardHeader>
        <CardContent><Skeleton className="h-50 w-full" /></CardContent>
      </Card>
    );
  }

  const sttRows = data?.stt ?? [];
  const ttsRows = data?.tts ?? [];
  const hasData = sttRows.length > 0 || ttsRows.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <Activity className="size-4 text-muted-foreground" />
          Provider Latency
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No latency data available</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead className="text-right">Avg (ms)</TableHead>
                <TableHead className="text-right">P50 (ms)</TableHead>
                <TableHead className="text-right">P95 (ms)</TableHead>
                <TableHead className="text-right">Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sttRows.map((r) => (
                <TableRow key={`stt-${r.provider}`}>
                  <TableCell className="font-medium">STT</TableCell>
                  <TableCell>{r.provider}</TableCell>
                  <TableCell className="text-right">{r.avg}</TableCell>
                  <TableCell className="text-right">{r.p50}</TableCell>
                  <TableCell className="text-right">{r.p95}</TableCell>
                  <TableCell className="text-right">{r.count.toLocaleString()}</TableCell>
                </TableRow>
              ))}
              {ttsRows.map((r) => (
                <TableRow key={`tts-${r.provider}`}>
                  <TableCell className="font-medium">TTS</TableCell>
                  <TableCell>{r.provider}</TableCell>
                  <TableCell className="text-right">{r.avg}</TableCell>
                  <TableCell className="text-right">{r.p50}</TableCell>
                  <TableCell className="text-right">{r.p95}</TableCell>
                  <TableCell className="text-right">{r.count.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
