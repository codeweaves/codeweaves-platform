'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  useAssignableRoles,
  useSetUserRoles,
  type ManagedUserDetail,
} from '@/hooks/use-rbac';
import { useProfile } from '@/hooks/use-profile';

interface EditRolesDialogProps {
  user: ManagedUserDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditRolesDialog({ user, open, onOpenChange }: EditRolesDialogProps) {
  const { profile } = useProfile();
  const { data: roles, isLoading } = useAssignableRoles(open);
  const setRoles = useSetUserRoles(user.id);

  const [selected, setSelected] = useState<string[]>(user.roleKeys);

  // Reset to the server's view each time the dialog opens, so a cancelled edit
  // never leaks into the next one.
  useEffect(() => {
    if (open) setSelected(user.roleKeys);
  }, [open, user.roleKeys]);

  const isSelf = profile?.id === user.id;

  /**
   * Roles the user already holds that this caller cannot assign, e.g. an org
   * manager viewing someone who holds `org.owner`. They are shown as locked
   * rather than hidden, otherwise saving would silently strip them.
   */
  const lockedRoleKeys = useMemo(() => {
    if (!roles) return [];
    const assignable = new Set(roles.map((r) => r.key));
    return user.roleKeys.filter((k) => !assignable.has(k));
  }, [roles, user.roleKeys]);

  const toggle = (key: string) => {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const handleSave = async () => {
    // Locked roles are preserved. The API would reject an attempt to strip one
    // anyway; keeping them here avoids a confusing failure on save.
    const payload = [...new Set([...selected, ...lockedRoleKeys])];

    if (payload.length === 0) {
      toast.error('A user must hold at least one role.');
      return;
    }

    try {
      await setRoles.mutateAsync(payload);
      toast.success('Roles updated');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update roles');
    }
  };

  const nothingChanged =
    selected.length === user.roleKeys.length &&
    selected.every((k) => user.roleKeys.includes(k));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Roles</DialogTitle>
          <DialogDescription>
            {user.name ?? user.email} can do everything their checked roles allow,
            combined.
          </DialogDescription>
        </DialogHeader>

        {isSelf && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            You cannot change your own roles.
          </p>
        )}

        <div className="thin-scroll max-h-[22rem] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : !roles || roles.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              You do not have permission to assign roles.
            </p>
          ) : (
            <div className="divide-y">
              {lockedRoleKeys.map((key) => (
                <div key={key} className="flex items-start gap-3 py-3 opacity-70">
                  <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="font-mono text-sm">{key}</div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Held already. Only Klivo staff can change this role.
                    </p>
                  </div>
                </div>
              ))}

              {roles.map((role) => (
                <label
                  key={role.key}
                  className="flex cursor-pointer items-start gap-3 py-3"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={selected.includes(role.key)}
                    onCheckedChange={() => toggle(role.key)}
                    disabled={isSelf || setRoles.isPending}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{role.key}</span>
                      <span className="text-xs text-muted-foreground">{role.name}</span>
                    </div>
                    {role.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {role.description}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {role.permissions.map((p) => (
                        <Badge
                          key={p}
                          variant="secondary"
                          className="px-1.5 py-0 font-mono text-[10px]"
                        >
                          {p}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={setRoles.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSelf || setRoles.isPending || nothingChanged}
          >
            {setRoles.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save roles
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
