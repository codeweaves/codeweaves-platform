'use client';

import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useInviteMember } from '@/hooks/use-team';
import { useOrganizations } from '@/hooks/use-organizations';
import { usePermissions } from '@/hooks/use-permissions';
import { useAssignableRoles } from '@/hooks/use-rbac';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteMemberDialog() {
  const inviteMember = useInviteMember();

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [roleKeys, setRoleKeys] = useState<string[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [error, setError] = useState('');
  const { can } = usePermissions();

  // Inviting is platform-only today, but listing organizations is a separate
  // permission — skip the request rather than 403 if those ever diverge.
  const { data: orgsData } = useOrganizations(
    { limit: 100 },
    { enabled: can('Organization:ReadAll') },
  );
  // Already filtered to what the caller may grant, so the invite cannot hand out
  // a role the same person could not assign afterwards.
  const { data: roles, isLoading: rolesLoading } = useAssignableRoles(open);

  // An org invite needs an organization; a platform invite must not have one.
  const isOrgInvite = roleKeys.length > 0 && roleKeys.every((k) => k.startsWith('org.'));

  const toggleRole = (key: string) => {
    setRoleKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail) {
      setError('Email is required');
      return;
    }

    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setError('Please enter a valid email address');
      return;
    }

    if (roleKeys.length === 0) {
      setError('Select at least one role');
      return;
    }

    const allOrg = roleKeys.every((k) => k.startsWith('org.'));
    const allPlatform = roleKeys.every((k) => !k.startsWith('org.'));
    if (!allOrg && !allPlatform) {
      setError('An invitation cannot mix organization and platform roles');
      return;
    }

    if (allOrg && !selectedOrgId) {
      setError('Select an organization for an organization role');
      return;
    }

    try {
      await inviteMember.mutateAsync({
        email: trimmedEmail,
        roleKeys,
        ...(isOrgInvite && { organizationId: selectedOrgId }),
      });
      toast.success('Invitation sent');
      handleClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send invitation';
      if (message.includes('already exists')) {
        setError('This user already has an account');
      } else if (message.includes('Pending invitation')) {
        setError('A pending invitation already exists for this email');
      } else {
        setError(message);
      }
    }
  };

  const handleClose = () => {
    setOpen(false);
    setEmail('');
    setRoleKeys([]);
    setSelectedOrgId('');
    setError('');
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setOpen(true);
    } else {
      handleClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="mr-2 h-4 w-4" />
          Invite Member
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-8">
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>
              Send an invitation to join an organization.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 grid gap-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="colleague@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value.trimStart())}
                maxLength={255}
                disabled={inviteMember.isPending}
                autoFocus
              />
            </div>
            <div className="col-span-2 grid gap-2 min-w-0">
              <Label>Organization</Label>
              <SearchableSelect
                options={orgsData?.data.map((org) => ({
                  value: org.id,
                  label: org.name,
                })) ?? []}
                value={selectedOrgId}
                onValueChange={setSelectedOrgId}
                placeholder="Select an organization"
                searchPlaceholder="Search organizations..."
                emptyMessage="No organizations found"
                disabled={inviteMember.isPending}
                triggerClassName="w-full"
              />
            </div>
            <div className="col-span-2 grid gap-2">
              <Label>Roles</Label>
              <p className="text-xs text-muted-foreground">
                What this person can do from their first sign-in.
              </p>
              <div className="thin-scroll max-h-52 divide-y overflow-y-auto rounded-md border px-3">
                {rolesLoading ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    Loading roles…
                  </div>
                ) : !roles || roles.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    You do not have permission to assign roles.
                  </div>
                ) : (
                  roles.map((r) => (
                    <label
                      key={r.key}
                      className="flex cursor-pointer items-start gap-3 py-2.5"
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={roleKeys.includes(r.key)}
                        onCheckedChange={() => toggleRole(r.key)}
                        disabled={inviteMember.isPending}
                      />
                      <span className="min-w-0">
                        <span className="block font-mono text-sm">{r.key}</span>
                        {r.description && (
                          <span className="block text-xs text-muted-foreground">
                            {r.description}
                          </span>
                        )}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
            {error && (
              <p className="col-span-2 text-sm text-destructive">{error}</p>
            )}
          </div>
          <DialogFooter className="border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={inviteMember.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                inviteMember.isPending ||
                !email.trim() ||
                roleKeys.length === 0 ||
                (isOrgInvite && !selectedOrgId)
              }
            >
              {inviteMember.isPending ? 'Sending...' : 'Send Invitation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
