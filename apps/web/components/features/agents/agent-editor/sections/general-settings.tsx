'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAgentEditor } from '../agent-editor-context';
import { FormSection } from '../form-section';
import { usePermissions } from '@/hooks/use-permissions';

export function GeneralSettings() {
  const { agent, formData, updateFormData } = useAgentEditor();
  const { can } = usePermissions();
  // Guards the organization mapping, which only cross-org callers can change.
  const isAdmin = can('Organization:ReadAll');

  return (
    <div className="space-y-6">
      <FormSection title="General" description="Basic details and ownership">
        <div className="space-y-4">
          <div className="grid grid-cols-3 items-center gap-4">
            <Label className="text-sm font-medium">Agent Name</Label>
            <Input
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
                value={agent.organization?.name ?? '-'}
                disabled
                className="col-span-2 bg-muted"
              />
            </div>
          )}
        </div>
      </FormSection>
    </div>
  );
}
