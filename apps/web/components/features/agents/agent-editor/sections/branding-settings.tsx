'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAgentEditor } from '../agent-editor-context';
import { useProfile } from '@/hooks/use-profile';

export function BrandingSettings() {
  const { profile } = useProfile();
  const { formData, updateFormData } = useAgentEditor();

  const isAdmin =
    profile?.role === 'SUPER_ADMIN' || profile?.role === 'ADMIN';

  if (!isAdmin) return null;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Branding</h3>
        <p className="text-sm text-muted-foreground">
          Configure the footer branding of the widget
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
          <div>
            <Label className="text-sm font-medium">Show Branding</Label>
            <p className="text-xs text-muted-foreground">
              Toggle to show or hide the branding footer
            </p>
          </div>
          <Switch
            checked={formData.brandingEnabled}
            onCheckedChange={(v: boolean) => updateFormData('brandingEnabled', v)}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Prefix Text</Label>
          <Input
            value={formData.brandingTextPrefix}
            onChange={(e) =>
              updateFormData('brandingTextPrefix', e.target.value)
            }
            placeholder="Powered by"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Link Text</Label>
            <Input
              value={formData.brandingLinkText}
              onChange={(e) =>
                updateFormData('brandingLinkText', e.target.value)
              }
              placeholder="Codeweaves"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Link URL</Label>
            <Input
              value={formData.brandingLinkUrl}
              onChange={(e) =>
                updateFormData('brandingLinkUrl', e.target.value)
              }
              placeholder="https://codeweaves.com"
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Branding settings will be fully stored in the AgentTheme model
          (Epic 4). For now, these fields are UI-only.
        </p>
      </div>
    </div>
  );
}
