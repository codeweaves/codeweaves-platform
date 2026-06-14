import type {
  AnalyticsSummaryResponse,
  AgentAnalyticsRow,
  VoiceSummaryResponse,
  VoiceLatencyResponse,
  LanguageDistributionResponse,
} from '@/hooks/use-analytics';

export interface AnalyticsExportData {
  summary: AnalyticsSummaryResponse;
  agents: AgentAnalyticsRow[];
  /** Voice data — only present/exported when the org has voice activity. */
  voiceSummary?: VoiceSummaryResponse;
  voiceLatency?: VoiceLatencyResponse;
  voiceLanguages?: LanguageDistributionResponse;
}

// Curated, human-labeled KPI list for export — mirrors the current dashboard
// cards instead of dumping every raw response key (which surfaced removed
// metrics like userGrowthRate with cryptic names). Fallback Rate is appended
// separately because it's conditional on the agent having phrases configured.
const KPI_EXPORT_FIELDS: {
  key: keyof AnalyticsSummaryResponse['kpis'];
  label: string;
}[] = [
  { key: 'totalUsers', label: 'Total Users' },
  { key: 'newUsers', label: 'New Users' },
  { key: 'returningUsers', label: 'Returning Users' },
  { key: 'userRetentionRate', label: 'User Retention (%)' },
  { key: 'totalConversations', label: 'Total Conversations' },
  { key: 'totalMessagesExchanged', label: 'Total Messages' },
  { key: 'totalMessagesSent', label: 'Messages Sent' },
  { key: 'totalMessagesReceived', label: 'Messages Received' },
  { key: 'avgTimeToFirstTokenMs', label: 'Time to First Token (ms)' },
  { key: 'avgResponseTimeMs', label: 'Avg Response Time (ms)' },
  { key: 'p50ResponseTimeMs', label: 'P50 Response Time (ms)' },
  { key: 'p95ResponseTimeMs', label: 'P95 Response Time (ms)' },
  { key: 'p99ResponseTimeMs', label: 'P99 Response Time (ms)' },
];

function escapeCsvField(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function kpiLine(label: string, value: number | null, trend: number | null | undefined): string {
  return `${escapeCsvField(label)},${value != null ? escapeCsvField(value) : ''},${trend != null ? escapeCsvField(trend) : ''}`;
}

export function exportToCsv(data: AnalyticsExportData, filename: string) {
  const lines: string[] = [];

  // Date range metadata
  lines.push(`Date Range,${data.summary.period.start},${data.summary.period.end}`);
  lines.push('');

  // KPI Summary section — curated + labeled
  lines.push('KPI Summary');
  lines.push('Metric,Value,Trend (%)');
  for (const field of KPI_EXPORT_FIELDS) {
    const kpi = data.summary.kpis[field.key];
    if (!kpi) continue;
    lines.push(kpiLine(field.label, kpi.value, kpi.trend));
  }
  // Fallback Rate only when an agent has phrases configured (matches the card).
  if (data.summary.fallbackConfigured) {
    const fb = data.summary.kpis.couldntAnswerRate;
    lines.push(kpiLine('Fallback Rate (%)', fb.value, fb.trend));
  }

  // Voice section — only when there's voice activity.
  const vs = data.voiceSummary;
  if (vs && vs.totalVoiceMessages > 0) {
    const stt = data.voiceLatency?.sttAggregate;
    const tts = data.voiceLatency?.ttsAggregate;
    lines.push('');
    lines.push('Voice');
    lines.push('Metric,Value');
    lines.push(`Voice Messages,${escapeCsvField(vs.totalVoiceMessages)}`);
    lines.push(`Voice / Text Ratio (%),${escapeCsvField(Math.round(vs.voiceRatio * 1000) / 10)}`);
    lines.push(`Avg STT Latency (ms),${escapeCsvField(vs.avgSttLatencyMs)}`);
    if (stt) {
      lines.push(`STT P50 (ms),${escapeCsvField(stt.p50)}`);
      lines.push(`STT P95 (ms),${escapeCsvField(stt.p95)}`);
    }
    lines.push(`Avg TTS Latency (ms),${escapeCsvField(vs.avgTtsLatencyMs)}`);
    if (tts) {
      lines.push(`TTS P50 (ms),${escapeCsvField(tts.p50)}`);
      lines.push(`TTS P95 (ms),${escapeCsvField(tts.p95)}`);
    }

    const langs = data.voiceLanguages?.languages ?? [];
    if (langs.length > 0) {
      lines.push('');
      lines.push('Voice Languages');
      lines.push('Language,Count,Percentage (%)');
      for (const l of langs) {
        lines.push(
          `${escapeCsvField(l.language)},${escapeCsvField(l.count)},${escapeCsvField(l.percentage)}`,
        );
      }
    }
  }

  lines.push(''); // blank separator

  // Agent Metrics section
  lines.push('Per-Agent Metrics');
  lines.push('Agent,Conversations,Messages,Avg Response (ms),Queries');
  for (const agent of data.agents) {
    lines.push(
      [
        escapeCsvField(agent.agentName),
        escapeCsvField(agent.conversations),
        escapeCsvField(agent.messages),
        escapeCsvField(agent.avgResponseTimeMs),
        escapeCsvField(agent.queriesRaised),
      ].join(','),
    );
  }

  // UTF-8 BOM for Excel compatibility
  downloadFile('﻿' + lines.join('\n'), filename, 'text/csv;charset=utf-8');
}

export function exportToJson(data: AnalyticsExportData, filename: string) {
  downloadFile(JSON.stringify(data, null, 2), filename, 'application/json');
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
