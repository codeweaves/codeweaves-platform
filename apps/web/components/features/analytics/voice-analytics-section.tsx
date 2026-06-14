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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { KpiCard } from './kpi-card';
import { BreakdownBars } from './breakdown-bars';
import { languageLabel } from './language-labels';
import { Mic, Timer, Languages, Activity, Info } from 'lucide-react';
import type { ReactNode } from 'react';
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
            Enable voice on an agent to see voice volume and languages here.
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
        <VoiceLatencyCard data={latencyQuery.data} isLoading={latencyQuery.isLoading} />
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

// Right-aligned table header with a plain-language info tooltip — P50/P95 are
// percentiles most users (technical or not) can't read at a glance.
function HeaderWithInfo({ label, info }: { label: string; info: ReactNode }) {
  return (
    <span className="inline-flex items-center justify-end gap-1">
      {label}
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`What is ${label}?`}
              className="text-muted-foreground/50 transition-colors hover:text-muted-foreground"
            >
              <Info className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-65">
            <span className="block leading-relaxed [&_strong]:font-semibold [&_strong]:text-background">
              {info}
            </span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}

// --- Voice Latency (provider-agnostic: average + percentiles for STT & TTS) ---
function VoiceLatencyCard({ data, isLoading }: { data?: VoiceLatencyResponse; isLoading: boolean }) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  const rows: { type: string; avg: number; p50: number; p95: number }[] = [];
  if (data?.sttAggregate) rows.push({ type: 'Speech-to-text', ...data.sttAggregate });
  if (data?.ttsAggregate) rows.push({ type: 'Text-to-speech', ...data.ttsAggregate });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <Activity className="size-4 text-muted-foreground" />
          Voice Latency
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No latency data available</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Avg (ms)</TableHead>
                <TableHead className="text-right">
                  <HeaderWithInfo
                    label="P50 (ms)"
                    info={
                      <>
                        The <strong>middle</strong> reply time — half of replies
                        were faster than this, half slower. A good read on the{' '}
                        <strong>typical</strong> speed.
                      </>
                    }
                  />
                </TableHead>
                <TableHead className="text-right">
                  <HeaderWithInfo
                    label="P95 (ms)"
                    info={
                      <>
                        <strong>95% of replies were faster</strong> than this —
                        only the <strong>slowest 5%</strong> took longer. Good for
                        spotting worst-case lag.
                      </>
                    }
                  />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.type}>
                  <TableCell className="font-medium">{r.type}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.avg}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.p50}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.p95}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

