'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useCreateAgent } from '@/hooks/use-agents';
import { useOrganizations } from '@/hooks/use-organizations';

export function CreateAgentDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [error, setError] = useState('');
  const createAgent = useCreateAgent();
  const { data: orgsData, isLoading: orgsLoading } = useOrganizations({ limit: 100 });

  // Auto-select when there's only one org
  useEffect(() => {
    if (orgsData?.data && orgsData.data.length === 1 && !organizationId) {
      setOrganizationId(orgsData.data[0]!.id);
    }
  }, [orgsData, organizationId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (name.trim().length < 1) {
      setError('Agent name is required');
      return;
    }

    if (!organizationId) {
      setError('Please select an organization');
      return;
    }

    try {
      const agent = await createAgent.mutateAsync({
        name: name.trim(),
        organizationId,
      });
      toast.success('Agent created successfully');
      setOpen(false);
      setName('');
      setOrganizationId('');
      // Navigate directly to the new agent's edit page
      router.push(`/dashboard/agents/${agent.id}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to create agent';
      setError(message);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setName('');
      setOrganizationId('');
      setError('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 hover:text-white"
        >
          Create New Agent
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Agent</DialogTitle>
            <DialogDescription>
              Add a new chat agent for an organization.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="agent-name">Agent Name</Label>
              <Input
                id="agent-name"
                placeholder="e.g. Customer Support Bot"
                value={name}
                onChange={(e) => setName(e.target.value.trimStart())}
                maxLength={100}
                disabled={createAgent.isPending}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="agent-org">Organization</Label>
              <SearchableSelect
                id="agent-org"
                options={orgsData?.data.map((org) => ({
                  value: org.id,
                  label: org.name,
                })) ?? []}
                value={organizationId}
                onValueChange={setOrganizationId}
                placeholder={orgsLoading ? 'Loading...' : 'Select organization'}
                searchPlaceholder="Search organizations..."
                emptyMessage="No organizations found"
                disabled={createAgent.isPending || orgsLoading}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={createAgent.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                createAgent.isPending ||
                name.trim().length < 1 ||
                !organizationId
              }
            >
              {createAgent.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
