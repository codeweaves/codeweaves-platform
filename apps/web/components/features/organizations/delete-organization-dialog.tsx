'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useOrganizationDeletePreview,
  useDeleteOrganization,
  type DeleteOrganizationResult,
} from '@/hooks/use-organizations';

interface DeleteOrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /**
   * The org name as the dialog opens. The user must type it verbatim to enable
   * the delete button. Keeping this as a prop avoids a flash of "loading…"
   * while we fetch the preview, since the parent already has the name.
   */
  organizationName: string;
  onDeleted?: (result: DeleteOrganizationResult) => void;
}

/**
 * Type-the-name confirmation for soft-deleting an organization. Shows
 * impact counts (active agents + members) fetched on open. Cascade is
 * handled server-side; the only client work is "yes I really mean it."
 */
export function DeleteOrganizationDialog({
  open,
  onOpenChange,
  organizationId,
  organizationName,
  onDeleted,
}: DeleteOrganizationDialogProps) {
  const [confirmText, setConfirmText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const previewQuery = useOrganizationDeletePreview(organizationId, open);
  const deleteMutation = useDeleteOrganization();

  // Reset transient state every time the dialog reopens so a previous
  // half-completed attempt doesn't leak into the next one.
  useEffect(() => {
    if (open) {
      setConfirmText('');
      setErrorMessage(null);
    }
  }, [open]);

  const trimmed = confirmText.trim();
  const nameMatches = trimmed === organizationName;
  const isSubmitting = deleteMutation.isPending;
  const isLoadingPreview = previewQuery.isLoading;
  const previewFailed = previewQuery.isError;

  const handleDelete = async () => {
    if (!nameMatches || isSubmitting) return;
    setErrorMessage(null);
    try {
      const result = await deleteMutation.mutateAsync(organizationId);
      onDeleted?.(result);
      onOpenChange(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to delete organization');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !isSubmitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="space-y-2">
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" />
            Delete organization
          </DialogTitle>
          <DialogDescription>
            This action soft-deletes the organization. Members will lose access on
            their next session and all agents will stop responding to widget traffic.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Impact counts — render skeletons while loading so layout stays stable */}
          <div className="rounded-md border bg-muted/40 p-4 text-sm">
            {isLoadingPreview ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Calculating impact…
              </div>
            ) : previewFailed ? (
              <p className="text-destructive">
                Couldn&apos;t load impact summary — counts unavailable.
              </p>
            ) : previewQuery.data ? (
              <ul className="space-y-1.5">
                <li>
                  <span className="font-medium">{previewQuery.data.activeAgentsCount}</span>{' '}
                  active agent{previewQuery.data.activeAgentsCount === 1 ? '' : 's'} will stop responding
                </li>
                <li>
                  <span className="font-medium">{previewQuery.data.membersCount}</span>{' '}
                  member{previewQuery.data.membersCount === 1 ? '' : 's'} will lose access
                </li>
              </ul>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-org-name">
              Type <span className="font-mono font-semibold">{organizationName}</span> to confirm
            </Label>
            <Input
              id="confirm-org-name"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={organizationName}
              autoComplete="off"
              spellCheck={false}
              disabled={isSubmitting}
            />
          </div>

          {errorMessage && (
            <p className="text-sm text-destructive">{errorMessage}</p>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={!nameMatches || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" /> Deleting…
              </>
            ) : (
              'Delete organization'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
