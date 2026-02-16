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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useInviteMember } from '@/hooks/use-team';
import { useCurrentRole } from '@/hooks/use-current-role';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { useOrganizations } from '@/hooks/use-organizations';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteMemberDialog() {
  const inviteMember = useInviteMember();
  const { isSuperAdmin } = useCurrentRole();
  const { organization } = useCurrentOrganization();

  // Super admin without org context picks org + role (ADMIN/SUPER_ADMIN)
  // With org context, role is always CLIENT
  const needsOrgPicker = isSuperAdmin && !organization;

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(needsOrgPicker ? 'ADMIN' : 'CLIENT');
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [error, setError] = useState('');

  const { data: orgsData } = useOrganizations(
    needsOrgPicker ? { limit: 100 } : {},
  );

  const resolvedOrgId = organization?.id ?? selectedOrgId;

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

    if (!resolvedOrgId) {
      setError('Please select an organization');
      return;
    }

    try {
      await inviteMember.mutateAsync({
        email: trimmedEmail,
        role,
        organizationId: resolvedOrgId,
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
    setRole(needsOrgPicker ? 'ADMIN' : 'CLIENT');
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
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription className="truncate">
              Send an invitation to join{' '}
              {organization ? organization.name : 'an organization'}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
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
            {needsOrgPicker && (
              <div className="grid gap-2">
                <Label htmlFor="invite-org">Organization</Label>
                <Select
                  value={selectedOrgId}
                  onValueChange={setSelectedOrgId}
                  disabled={inviteMember.isPending}
                >
                  <SelectTrigger id="invite-org">
                    <SelectValue placeholder="Select an organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {orgsData?.data.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                value={role}
                onValueChange={setRole}
                disabled={!needsOrgPicker || inviteMember.isPending}
              >
                <SelectTrigger id="invite-role">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {needsOrgPicker ? (
                    <>
                      <SelectItem value="ADMIN">Admin</SelectItem>
                      <SelectItem value="SUPER_ADMIN">Super Admin</SelectItem>
                    </>
                  ) : (
                    <SelectItem value="CLIENT">Client</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
          <DialogFooter>
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
              disabled={inviteMember.isPending || !email.trim() || !resolvedOrgId}
            >
              {inviteMember.isPending ? 'Sending...' : 'Send Invitation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
