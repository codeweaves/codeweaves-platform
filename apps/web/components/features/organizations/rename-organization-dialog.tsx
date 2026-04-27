'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
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
  useUpdateOrganization,
  type Organization,
} from '@/hooks/use-organizations';

interface RenameOrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  currentName: string;
  onRenamed?: (org: Organization) => void;
}

/**
 * Minimal rename dialog — just the name field. Slug stays as-is because
 * customer widget script tags reference the org indirectly via the agent's
 * publicId, not the slug, so renaming is purely cosmetic.
 */
export function RenameOrganizationDialog({
  open,
  onOpenChange,
  organizationId,
  currentName,
  onRenamed,
}: RenameOrganizationDialogProps) {
  const [name, setName] = useState(currentName);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const updateMutation = useUpdateOrganization();

  useEffect(() => {
    if (open) {
      setName(currentName);
      setErrorMessage(null);
    }
  }, [open, currentName]);

  const trimmed = name.trim();
  const isUnchanged = trimmed === currentName.trim();
  const isInvalid = trimmed.length === 0 || trimmed.length > 100;
  const isSubmitting = updateMutation.isPending;

  const handleRename = async () => {
    if (isInvalid || isUnchanged || isSubmitting) return;
    setErrorMessage(null);
    try {
      const result = await updateMutation.mutateAsync({
        id: organizationId,
        data: { name: trimmed },
      });
      onRenamed?.(result);
      onOpenChange(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to rename organization');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !isSubmitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="space-y-2">
          <DialogTitle>Rename organization</DialogTitle>
          <DialogDescription>
            Update the display name for this organization. The slug stays the same.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="rename-org-name">Organization name</Label>
            <Input
              id="rename-org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Corp"
              autoFocus
              disabled={isSubmitting}
              maxLength={100}
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
            onClick={handleRename}
            disabled={isInvalid || isUnchanged || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" /> Saving…
              </>
            ) : (
              'Save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
