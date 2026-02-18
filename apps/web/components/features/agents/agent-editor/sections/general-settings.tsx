'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAgentEditor } from '../agent-editor-context';
import { useProfile } from '@/hooks/use-profile';

export function GeneralSettings() {
  const { agent, formData, updateFormData } = useAgentEditor();
  const { profile } = useProfile();
  const isAdmin =
    profile?.role === 'SUPER_ADMIN' || profile?.role === 'ADMIN';

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">General</h3>
        <p className="text-sm text-muted-foreground">
          Basic details and ownership
        </p>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-3 items-center gap-4">
          <Label htmlFor="agent-name" className="text-sm font-medium">
            Agent Name
          </Label>
          <Input
            id="agent-name"
            value={formData.name}
            onChange={(e) => updateFormData('name', e.target.value)}
            placeholder="e.g., Customer Support Bot"
            className="col-span-2"
          />
        </div>

        {isAdmin && (
          <div className="grid grid-cols-3 items-center gap-4">
            <Label className="text-sm font-medium">Organization</Label>
            <Input
              value={agent.organization?.name ?? '—'}
              disabled
              className="col-span-2 bg-muted"
            />
          </div>
        )}
      </div>
    </div>
  );
}
