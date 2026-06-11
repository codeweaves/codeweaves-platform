import type {
  AnalyticsSummaryResponse,
  AgentAnalyticsRow,
} from '@/hooks/use-analytics';

export interface AnalyticsExportData {
  summary: AnalyticsSummaryResponse;
  agents: AgentAnalyticsRow[];
}

function escapeCsvField(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportToCsv(data: AnalyticsExportData, filename: string) {
  const lines: string[] = [];

  // Date range metadata
  lines.push(`Date Range,${data.summary.period.start},${data.summary.period.end}`);
  lines.push('');

  // KPI Summary section
  lines.push('KPI Summary');
  lines.push('Metric,Value,Trend (%)');
  for (const [key, kpi] of Object.entries(data.summary.kpis)) {
    lines.push(
      `${escapeCsvField(key)},${escapeCsvField(kpi.value ?? '')},${kpi.trend != null ? escapeCsvField(kpi.trend) : ''}`,
    );
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
  downloadFile('\uFEFF' + lines.join('\n'), filename, 'text/csv;charset=utf-8');
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
