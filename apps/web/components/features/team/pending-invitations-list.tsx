'use client';

import { useState } from 'react';
import { AlertCircle, Mail, RotateCw, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
  usePendingInvitations,
  useResendInvitation,
  useCancelInvitation,
  type Invitation,
} from '@/hooks/use-team';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { RoleBadge } from './team-members-list';
import { formatDate } from '@/lib/utils';

const statusBadgeConfig: Record<string, { label: string; className: string }> = {
  PENDING: {
    label: 'Pending',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  },
  ACCEPTED: {
    label: 'Accepted',
    className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  },
  EXPIRED: {
    label: 'Expired',
    className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  },
};

function StatusBadge({ status }: { status: string }) {
  const config = statusBadgeConfig[status] ?? {
    label: status,
    className: '',
  };
  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
    </Badge>
  );
}

function InvitationRow({
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
  const isPending = invitation.status === 'PENDING';

  return (
    <TableRow>
      <TableCell className="font-medium">{invitation.email}</TableCell>
      <TableCell>
        <RoleBadge role={invitation.role} />
      </TableCell>
      <TableCell>
        <StatusBadge status={invitation.status} />
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatDate(invitation.createdAt)}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatDate(invitation.expiresAt)}
      </TableCell>
      <TableCell>
        {isPending && (
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
        )}
      </TableCell>
    </TableRow>
  );
}

function TableSkeleton() {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Sent</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 2 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-5 w-40" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-5 w-24" /></TableCell>
              <TableCell><Skeleton className="h-5 w-24" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function PendingInvitationsList() {
  const { organization } = useCurrentOrganization();
  const { data: invitations, isLoading, isError } = usePendingInvitations(organization?.id);
  const resendInvitation = useResendInvitation();
  const cancelInvitation = useCancelInvitation();
  const [cancelTarget, setCancelTarget] = useState<Invitation | null>(null);
  const [resendTarget, setResendTarget] = useState<Invitation | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

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

  // Filter to show only pending invitations in this section
  const pendingInvitations = invitations?.filter((inv) => inv.status === 'PENDING') ?? [];

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Pending Invitations</h2>

      {isLoading ? (
        <TableSkeleton />
      ) : isError ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <AlertCircle className="h-12 w-12 text-destructive/50" />
          <h3 className="mt-4 text-lg font-semibold">Failed to load invitations</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Something went wrong. Please try refreshing the page.
          </p>
        </div>
      ) : !pendingInvitations.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <Mail className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">No pending invitations</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Invite team members using the button above.
          </p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="w-25">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingInvitations.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  onResend={setResendTarget}
                  onCancel={setCancelTarget}
                  isResending={resendingId === invitation.id}
                  isCancelling={cancellingId === invitation.id}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

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
