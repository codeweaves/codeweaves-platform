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
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useInviteMember } from '@/hooks/use-team';
import { useOrganizations } from '@/hooks/use-organizations';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteMemberDialog() {
  const inviteMember = useInviteMember();

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('CLIENT');
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [error, setError] = useState('');

  const { data: orgsData } = useOrganizations({ limit: 100 });

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

    if (role === 'CLIENT' && !selectedOrgId) {
      setError('Please select an organization for a client role');
      return;
    }

    try {
      await inviteMember.mutateAsync({
        email: trimmedEmail,
        role,
        ...(role === 'CLIENT' && { organizationId: selectedOrgId }),
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
    setRole('CLIENT');
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
            <div className="grid gap-2 min-w-0">
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
            <div className="grid gap-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                value={role}
                onValueChange={setRole}
                disabled={inviteMember.isPending}
              >
                <SelectTrigger id="invite-role" className="w-full">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CLIENT">Client</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                  <SelectItem value="SUPER_ADMIN">Super Admin</SelectItem>
                </SelectContent>
              </Select>
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
              disabled={inviteMember.isPending || !email.trim() || (role === 'CLIENT' && !selectedOrgId)}
            >
              {inviteMember.isPending ? 'Sending...' : 'Send Invitation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
