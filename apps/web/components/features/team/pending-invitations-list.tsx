'use client';

import { useCallback, useMemo, useState } from 'react';
import type { ColumnDef, Row } from '@tanstack/react-table';
import { AlertCircle, Loader2, Mail, RefreshCw, RotateCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DataTable,
  type DataTableFetchParams,
} from '@/components/ui/data-table';
import {
  useInvitations,
  useResendInvitation,
  useCancelInvitation,
  type Invitation,
} from '@/hooks/use-team';
import { RoleBadge } from './team-members-list';
import { formatDate } from '@/lib/utils';

// Use the shared semantic Badge variants so colors match the Active/Inactive
// badges in the agents table (`variant="success"` / `variant="error"`).
// PENDING uses the new `warning` variant.
const statusBadgeConfig: Record<string, { label: string; variant: 'success' | 'warning' | 'error' }> = {
  PENDING: { label: 'Pending', variant: 'warning' },
  ACCEPTED: { label: 'Accepted', variant: 'success' },
  EXPIRED: { label: 'Expired', variant: 'error' },
};

function StatusBadge({ status }: { status: string }) {
  const config = statusBadgeConfig[status];
  if (!config) {
    return <Badge variant="outline">{status}</Badge>;
  }
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function ActionsCell({
  invitation,
  onResend,
  onCancel,
  isResending,
  isCancelling,
}: {
  invitation: Invitation;
  onResend: (invitation: Invitation) => void;
  onCancel: (invitation: Invitation) => void;
  isResending: boolean;
  isCancelling: boolean;
}) {
  if (invitation.status !== 'PENDING') return null;

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onResend(invitation)}
              disabled={isResending}
            >
              <RotateCw className={`h-4 w-4 ${isResending ? 'animate-spin' : ''}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Resend invitation</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={() => onCancel(invitation)}
              disabled={isCancelling}
            >
              <X className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Cancel invitation</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

export function PendingInvitationsList() {
  const resendInvitation = useResendInvitation();
  const cancelInvitation = useCancelInvitation();
  const [cancelTarget, setCancelTarget] = useState<Invitation | null>(null);
  const [resendTarget, setResendTarget] = useState<Invitation | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [fetchParams, setFetchParams] = useState<DataTableFetchParams>({
    page: 0,
    pageSize: 10,
    sorting: [],
    search: '',
    filters: {},
  });

  // Map DataTable fetch params to API params. The status filter is a
  // multi-select, so DataTable hands us an array (or a single string when
  // exactly one option is selected). Normalize to an array either way.
  const rawStatusFilter = fetchParams.filters.status;
  const statusList: ('PENDING' | 'ACCEPTED' | 'EXPIRED')[] = (
    Array.isArray(rawStatusFilter)
      ? rawStatusFilter
      : rawStatusFilter
        ? [rawStatusFilter]
        : []
  ).filter((s): s is 'PENDING' | 'ACCEPTED' | 'EXPIRED' =>
    s === 'PENDING' || s === 'ACCEPTED' || s === 'EXPIRED',
  );

  const { data, isLoading, isFetching, isError, refetch } = useInvitations({
    page: fetchParams.page + 1, // API is 1-based
    limit: fetchParams.pageSize,
    search: fetchParams.search || undefined,
    statuses: statusList.length > 0 ? statusList : undefined,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });

  const handleFetch = useCallback((params: DataTableFetchParams) => {
    setFetchParams(params);
  }, []);

  const handleResendConfirm = async () => {
    if (!resendTarget) return;
    setResendingId(resendTarget.id);
    setResendTarget(null);
    try {
      await resendInvitation.mutateAsync(resendTarget.id);
      toast.success('Invitation resent');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resend invitation';
      toast.error(message);
    } finally {
      setResendingId(null);
    }
  };

  const handleCancelConfirm = async () => {
    if (!cancelTarget) return;
    const targetId = cancelTarget.id;
    setCancellingId(targetId);
    setCancelTarget(null);
    try {
      await cancelInvitation.mutateAsync(targetId);
      toast.success('Invitation cancelled');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to cancel invitation';
      toast.error(message);
    } finally {
      setCancellingId(null);
    }
  };

  const columns: ColumnDef<Invitation, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'email',
        header: 'Email',
        cell: ({ row }) => (
          <span className="break-all">{row.getValue('email')}</span>
        ),
        enableSorting: false,
      },
      {
        accessorKey: 'role',
        header: 'Role',
        cell: ({ row }) => <RoleBadge role={row.getValue('role')} />,
        enableSorting: false,
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.getValue('status')} />,
        enableSorting: false,
      },
      {
        accessorKey: 'createdAt',
        header: 'Sent',
        cell: ({ row }) => formatDate(row.getValue('createdAt')),
        enableSorting: false,
      },
      {
        accessorKey: 'expiresAt',
        header: 'Expires',
        cell: ({ row }) => formatDate(row.getValue('expiresAt')),
        enableSorting: false,
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }: { row: Row<Invitation> }) => (
          <ActionsCell
            invitation={row.original}
            onResend={setResendTarget}
            onCancel={setCancelTarget}
            isResending={resendingId === row.original.id}
            isCancelling={cancellingId === row.original.id}
          />
        ),
        enableSorting: false,
      },
    ],
    [resendingId, cancellingId],
  );

  // First-load empty state (no rows ever, no search/filter applied) shows
  // the onboarding card. Subsequent empty/error/loading states are handled
  // inside the DataTable via render props so the toolbar stays visible.
  const isFirstLoadEmpty =
    !isLoading && !isError && data?.meta.total === 0 && !fetchParams.search && statusList.length === 0;

  if (isFirstLoadEmpty) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Invitations</h2>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <Mail className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">No invitations yet</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Invite team members using the button above.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Invitations</h2>

      <DataTable<Invitation, unknown>
        columns={columns}
        data={data?.data ?? []}
        pageCount={data?.meta.totalPages ?? 0}
        totalItems={data?.meta.total ?? 0}
        // isFetching covers first load AND refetches (sort/search/page) — RQ's
        // isLoading is only true on the very first fetch, which would hide the
        // spinner whenever the user changed a filter.
        isLoading={isFetching}
        renderLoading={() => (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
        // Only override the default empty state when there's an actual error.
        {...(isError && {
          renderEmpty: () => (
            <div className="flex h-32 flex-col items-center justify-center gap-2">
              <AlertCircle className="size-6 text-destructive" />
              <span className="text-sm text-muted-foreground">Failed to load invitations</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <RefreshCw className={`size-3 ${isFetching ? 'animate-spin' : ''}`} />
                Try again
              </Button>
            </div>
          ),
        })}
        onFetch={handleFetch}
        initialPageSize={10}
        searchConfig={{
          placeholder: 'Search by email...',
          searchKey: 'search',
        }}
        filters={[
          {
            id: 'status',
            label: 'Status',
            multiSelect: true,
            options: [
              { label: 'Pending', value: 'PENDING' },
              { label: 'Accepted', value: 'ACCEPTED' },
              { label: 'Expired', value: 'EXPIRED' },
            ],
          },
        ]}
        showHeader={false}
        hideSelectionCount
      />

      {/* Resend confirmation dialog */}
      <AlertDialog open={!!resendTarget} onOpenChange={(open) => !open && setResendTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resend Invitation</AlertDialogTitle>
            <AlertDialogDescription>
              Resend the invitation to{' '}
              <span className="font-medium text-foreground">{resendTarget?.email}</span>?
              This will extend the expiration date.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResendConfirm}>
              Resend
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel confirmation dialog */}
      <AlertDialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Invitation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel the invitation for{' '}
              <span className="font-medium text-foreground">{cancelTarget?.email}</span>?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelConfirm}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Cancel Invitation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
