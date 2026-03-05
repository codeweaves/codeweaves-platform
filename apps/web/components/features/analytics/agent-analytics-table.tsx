'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header';
import { AlertCircle } from 'lucide-react';
import { formatNumber, formatDuration } from '@/lib/format-utils';
import {
  useAgentAnalytics,
  type AnalyticsParams,
  type AnalyticsQueryOptions,
  type AgentAnalyticsRow,
} from '@/hooks/use-analytics';
import type { DataTableFetchParams } from '@/components/ui/data-table/types';

interface AgentAnalyticsTableProps {
  params: AnalyticsParams;
  pollingOptions?: AnalyticsQueryOptions;
  className?: string;
}

const columns: ColumnDef<AgentAnalyticsRow>[] = [
  {
    accessorKey: 'agentName',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Agent" />,
    cell: ({ row }) => (
      <Link
        href={`/dashboard/agents/${row.original.agentId}`}
        className="text-primary hover:underline font-medium"
      >
        {row.original.agentName}
      </Link>
    ),
  },
  {
    accessorKey: 'conversations',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Conversations" />,
    cell: ({ row }) => formatNumber(row.original.conversations),
  },
  {
    accessorKey: 'messages',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Messages" />,
    cell: ({ row }) => formatNumber(row.original.messages),
  },
  {
    accessorKey: 'avgResponseTimeMs',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Avg Response" />,
    cell: ({ row }) => formatDuration(row.original.avgResponseTimeMs),
  },
  {
    accessorKey: 'queriesRaised',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Queries" />,
    cell: ({ row }) => formatNumber(row.original.queriesRaised),
  },
];

export function AgentAnalyticsTable({ params, pollingOptions, className }: AgentAnalyticsTableProps) {
  const [fetchParams, setFetchParams] = useState<DataTableFetchParams>({
    page: 0,
    pageSize: 10,
    sorting: [],
    search: '',
    filters: {},
  });

  // Reset to page 0 when parent filter params change (date range, agentId, orgId)
  const prevParamsRef = useRef(params);
  useEffect(() => {
    const prev = prevParamsRef.current;
    if (
      prev.startDate !== params.startDate ||
      prev.endDate !== params.endDate ||
      prev.agentId !== params.agentId ||
      prev.orgId !== params.orgId
    ) {
      setFetchParams((fp) => ({ ...fp, page: 0 }));
    }
    prevParamsRef.current = params;
  }, [params]);

  const queryParams = {
    ...params,
    page: fetchParams.page + 1, // API uses 1-based pages
    limit: fetchParams.pageSize,
    sortBy: fetchParams.sorting[0]?.id ?? 'conversations',
    sortOrder: (fetchParams.sorting[0]?.desc ? 'desc' : 'asc') as 'asc' | 'desc',
  };

  const { data, isLoading, isError } = useAgentAnalytics(queryParams, pollingOptions);

  const handleFetch = useCallback((newParams: DataTableFetchParams) => {
    setFetchParams(newParams);
  }, []);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base font-medium">Per-Agent Performance</CardTitle>
      </CardHeader>
      <CardContent>
        {isError ? (
          <div className="flex h-32 items-center justify-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            Failed to load agent analytics
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={data?.data ?? []}
            pageCount={data?.meta?.totalPages ?? 0}
            totalItems={data?.meta?.total ?? 0}
            onFetch={handleFetch}
            initialPageSize={10}
            pageSizeOptions={[5, 10, 50]}
            isLoading={isLoading}
            showHeader={false}
            showToolbar={false}
            fixedLayout={false}
            texts={{ noResults: 'No agent data for this period' }}
          />
        )}
      </CardContent>
    </Card>
  );
}
