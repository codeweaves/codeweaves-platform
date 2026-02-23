'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { Bot, Pencil, Code, ExternalLink, Trash2 } from 'lucide-react';
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFetchParams,
  type DataTableFilterConfig,
} from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAgents, useDeleteAgent, type Agent } from '@/hooks/use-agents';
import { useProfile } from '@/hooks/use-profile';
import { useOrganizations } from '@/hooks/use-organizations';
import { formatDate } from '@/lib/utils';
import { EmbedCodeDialog } from './embed-code-dialog';
import { toast } from 'sonner';

const SORTABLE_COLUMNS: Record<string, string> = {
  name: 'name',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

interface AgentsDataTableProps {
  emptyAction?: React.ReactNode;
}

export function AgentsDataTable({ emptyAction }: AgentsDataTableProps) {
  const router = useRouter();
  const { profile } = useProfile();
  const isAdmin = profile?.role === 'SUPER_ADMIN' || profile?.role === 'ADMIN';

  const [fetchParams, setFetchParams] = useState<DataTableFetchParams>({
    page: 0,
    pageSize: 10,
    sorting: [],
    search: '',
    filters: {},
  });

  const [embedAgent, setEmbedAgent] = useState<Agent | null>(null);
  const [deleteAgent, setDeleteAgent] = useState<Agent | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const deleteAgentMutation = useDeleteAgent();

  // Fetch organizations list for admin filter dropdown
  const { data: orgsData } = useOrganizations({ limit: 100 });

  // Map DataTable fetch params to API params
  const sortField = fetchParams.sorting[0];
  const sortBy = sortField
    ? (SORTABLE_COLUMNS[sortField.id] ?? sortField.id)
    : 'createdAt';
  const sortOrder = sortField ? (sortField.desc ? 'desc' : 'asc') : 'desc';

  const statusFilter = fetchParams.filters?.status as string | undefined;
  const orgFilter = fetchParams.filters?.organizationId as string | undefined;

  const { data, isLoading } = useAgents({
    page: fetchParams.page + 1, // API is 1-based
    limit: fetchParams.pageSize,
    search: fetchParams.search || undefined,
    status: statusFilter && statusFilter !== 'all'
      ? (statusFilter as 'ACTIVE' | 'INACTIVE')
      : undefined,
    organizationId: orgFilter && orgFilter !== 'all' ? orgFilter : undefined,
    sortBy: sortBy as 'name' | 'createdAt' | 'updatedAt',
    sortOrder,
  });

  const handleFetch = useCallback((params: DataTableFetchParams) => {
    setFetchParams(params);
  }, []);

  const handleDelete = async () => {
    if (!deleteAgent) return;
    try {
      await deleteAgentMutation.mutateAsync(deleteAgent.id);
      toast.success(`Agent "${deleteAgent.name}" deleted successfully`);
    } catch {
      toast.error('Failed to delete agent. Please try again.');
    } finally {
      setDeleteAgent(null);
      setDeleteConfirmText('');
    }
  };

  // Build columns based on role
  const columns: ColumnDef<Agent, unknown>[] = [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Name" />
      ),
      cell: ({ row }) => (
        <Link
          href={`/dashboard/agents/${row.original.id}`}
          className="font-medium text-primary hover:underline"
        >
          {row.getValue('name')}
        </Link>
      ),
    },
    // Organization column only for admins
    ...(isAdmin
      ? [
          {
            id: 'organization',
            accessorFn: (row: Agent) => row.organization?.name ?? '—',
            header: 'Organization',
            enableSorting: false,
          } satisfies ColumnDef<Agent, unknown>,
        ]
      : []),
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.original.status;
        return (
          <Badge variant={status === 'ACTIVE' ? 'default' : 'secondary'}>
            {status === 'ACTIVE' ? 'Active' : 'Inactive'}
          </Badge>
        );
      },
      enableSorting: false,
    },
    {
      accessorKey: 'createdAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Created" />
      ),
      cell: ({ row }) => formatDate(row.getValue('createdAt')),
    },
    {
      id: 'actions',
      header: () => <div className="text-center">Actions</div>,
      enableSorting: false,
      cell: ({ row }) => {
        const agent = row.original;
        return (
          <TooltipProvider>
          <div className="flex items-center justify-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => router.push(`/dashboard/agents/${agent.id}`)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setEmbedAgent(agent)}
                >
                  <Code className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Embed</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => window.open(`/agents/demo/${agent.id}`, '_blank')}
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Demo</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => setDeleteAgent(agent)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </div>
          </TooltipProvider>
        );
      },
    },
  ];

  // Build filters based on role
  const filters: DataTableFilterConfig[] = [
    {
      id: 'status',
      label: 'Status',
      options: [
        { label: 'Active', value: 'ACTIVE' },
        { label: 'Inactive', value: 'INACTIVE' },
      ],
    },
    // Organization filter only for admins
    ...(isAdmin && orgsData?.data
      ? [
          {
            id: 'organizationId',
            label: 'Organization',
            options: orgsData.data.map((org) => ({
              label: org.name,
              value: org.id,
            })),
          },
        ]
      : []),
  ];

  const isEmpty =
    !isLoading && data?.meta.total === 0 && !fetchParams.search && !statusFilter && !orgFilter;

  if (isEmpty && emptyAction) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
        <Bot className="h-12 w-12 text-muted-foreground/50" />
        <h3 className="mt-4 text-lg font-semibold">No agents found</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Get started by creating your first agent.
        </p>
        <div className="mt-4">{emptyAction}</div>
      </div>
    );
  }

  return (
    <>
      <DataTable<Agent, unknown>
        columns={columns}
        data={data?.data ?? []}
        pageCount={data?.meta.totalPages ?? 0}
        totalItems={data?.meta.total ?? 0}
        isLoading={isLoading}
        onFetch={handleFetch}
        initialPageSize={10}
        pageSizeOptions={[5, 10, 50, 100]}
        searchConfig={{
          placeholder: 'Search agents...',
          searchKey: 'search',
        }}
        filters={filters}
        showHeader={false}
        hideSelectionCount
      />

      {/* Controlled Embed Dialog */}
      {embedAgent && (
        <EmbedCodeDialog
          publicId={embedAgent.publicId}
          open={!!embedAgent}
          onOpenChange={(open) => {
            if (!open) setEmbedAgent(null);
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteAgent}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteAgent(null);
            setDeleteConfirmText('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Agent</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteAgent?.name}&quot;? This action
              cannot be undone. Type <span className="font-semibold">DELETE</span> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input
            type="text"
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder="Type DELETE to confirm"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-destructive"
          />
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirmText('')}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteConfirmText !== 'DELETE' || deleteAgentMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 disabled:pointer-events-none"
            >
              {deleteAgentMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
