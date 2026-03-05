'use client';

import { useCallback } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useApiClient } from '@/lib/api-client';
import {
  exportToCsv,
  exportToJson,
  type AnalyticsExportData,
} from '@/lib/export-utils';
import type {
  AnalyticsSummaryResponse,
  AgentAnalyticsRow,
} from '@/hooks/use-analytics';

interface AnalyticsExportButtonProps {
  summaryData: AnalyticsSummaryResponse | undefined;
  agentData: AgentAnalyticsRow[];
  startDate: string;
  endDate: string;
  orgName: string;
  disabled?: boolean;
}

export function AnalyticsExportButton({
  summaryData,
  agentData,
  startDate,
  endDate,
  orgName,
  disabled,
}: AnalyticsExportButtonProps) {
  const api = useApiClient();

  const handleExport = useCallback(
    async (format: 'csv' | 'json') => {
      if (!summaryData) return;

      const safeOrgName = orgName.replace(/[^a-zA-Z0-9-_]/g, '_');
      const filename = `analytics-${safeOrgName}-${startDate}-${endDate}.${format}`;

      const data: AnalyticsExportData = {
        summary: summaryData,
        agents: agentData,
      };

      if (format === 'csv') {
        exportToCsv(data, filename);
      } else {
        exportToJson(data, filename);
      }

      // Log export to audit trail (non-blocking)
      api
        .post('/analytics/export-log', {
          format,
          startDate,
          endDate,
        })
        .catch(() => {});
    },
    [summaryData, agentData, startDate, endDate, orgName, api],
  );

  const isDisabled = disabled || !summaryData;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={isDisabled}>
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExport('csv')}>
          Export CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('json')}>
          Export JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
