'use client';

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from 'recharts';
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
import { Mic, Timer, Languages, AlertTriangle } from 'lucide-react';
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

const PIE_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  '#8884d8',
  '#82ca9d',
  '#ffc658',
];

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  mr: 'Marathi',
  bn: 'Bengali',
  ta: 'Tamil',
  te: 'Telugu',
  gu: 'Gujarati',
  kn: 'Kannada',
  ml: 'Malayalam',
  pa: 'Punjabi',
  or: 'Odia',
  hinglish: 'Hinglish',
};

interface VoiceAnalyticsSectionProps {
  params: AnalyticsParams;
  pollingOptions?: AnalyticsQueryOptions;
}

export function VoiceAnalyticsSection({ params, pollingOptions }: VoiceAnalyticsSectionProps) {
  const summaryQuery = useVoiceSummary(params, pollingOptions);
  const summary = summaryQuery.data;
  const hasVoiceData = summary && summary.totalVoiceMessages > 0;

  // Only fetch language/latency data when we know voice data exists
  const languagesQuery = useLanguageDistribution(params, { ...pollingOptions, enabled: !!hasVoiceData });
  const latencyQuery = useVoiceLatency(params, { ...pollingOptions, enabled: !!hasVoiceData });

  return (
    <div className="space-y-6">
      {/* Voice KPI Cards */}
      <VoiceSummaryCards data={summary} isLoading={summaryQuery.isLoading} />

      {/* Empty state */}
      {!summaryQuery.isLoading && !hasVoiceData && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Mic className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <h3 className="text-lg font-medium">No voice conversations yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Enable voice on an agent to get started.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Charts + Table — only show when there's data */}
      {hasVoiceData && (
        <div className="grid gap-6 lg:grid-cols-2">
          <LanguagePieChart data={languagesQuery.data} isLoading={languagesQuery.isLoading} />
          <ProviderLatencyTable data={latencyQuery.data} isLoading={latencyQuery.isLoading} />
        </div>
      )}
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
      <KpiCard
        title="Voice / Text Ratio"
        value={voiceRatioPercent}
        icon={Mic}
        isLoading={isLoading}
      />
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

// --- Language Distribution Pie Chart ---
function LanguagePieChart({ data, isLoading }: { data?: LanguageDistributionResponse; isLoading: boolean }) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader><Skeleton className="h-5 w-40" /></CardHeader>
        <CardContent><Skeleton className="h-50 w-full" /></CardContent>
      </Card>
    );
  }

  const chartData = (data?.languages ?? []).map((l) => ({
    name: LANGUAGE_LABELS[l.language] ?? l.language,
    value: l.count,
    percentage: l.percentage,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Languages className="h-4 w-4" />
          Language Distribution
        </CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No language data available</p>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label
              >
                {chartData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
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
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4" />
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
