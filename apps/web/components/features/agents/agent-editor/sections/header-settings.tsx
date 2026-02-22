'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAgentEditor } from '../agent-editor-context';
import { FormSection } from '../form-section';
import { ColorPicker } from '../color-picker';

export function HeaderSettings() {
  const { themeData, updateThemeData } = useAgentEditor();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Header</h3>
        <p className="text-sm text-muted-foreground">
          Customize the chat widget header title, subtitle, logo, and colors
        </p>
      </div>

      {/* Header Content */}
      <FormSection title="Header Content" description="Title and subtitle displayed in the widget header">
        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Title</Label>
          <Input
            value={themeData.header.title}
            onChange={(e) => updateThemeData('header.title', e.target.value)}
            placeholder="Chat with us"
            className="col-span-2"
          />
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Subtitle</Label>
          <Input
            value={themeData.header.subtitle ?? ''}
            onChange={(e) =>
              updateThemeData('header.subtitle', e.target.value || undefined)
            }
            placeholder="We usually reply within a few minutes"
            className="col-span-2"
          />
        </div>
      </FormSection>

      {/* Header Appearance */}
      <FormSection title="Header Appearance" description="Background and text colors for the header">
        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Background Color</Label>
          <ColorPicker
            value={themeData.header.backgroundColor}
            onChange={(color) => updateThemeData('header.backgroundColor', color)}
            className="col-span-2"
          />
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Text Color</Label>
          <ColorPicker
            value={themeData.header.textColor}
            onChange={(color) => updateThemeData('header.textColor', color)}
            className="col-span-2"
          />
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Subtitle Color</Label>
          <ColorPicker
            value={themeData.header.subtitleColor}
            onChange={(color) => updateThemeData('header.subtitleColor', color)}
            className="col-span-2"
          />
        </div>
      </FormSection>

      {/* Logo */}
      <FormSection title="Logo" description="Optionally display a logo in the header">
        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Show Logo</Label>
          <div className="col-span-2">
            <Switch
              checked={themeData.header.showLogo}
              onCheckedChange={(checked) => updateThemeData('header.showLogo', checked)}
            />
          </div>
        </div>

        {themeData.header.showLogo && (
          <div className="grid grid-cols-3 items-center gap-4">
            <Label className="text-sm font-medium">Logo URL</Label>
            <Input
              value={themeData.header.logoUrl ?? ''}
              onChange={(e) =>
                updateThemeData('header.logoUrl', e.target.value || undefined)
              }
              placeholder="https://example.com/logo.png"
              className="col-span-2"
            />
          </div>
        )}
      </FormSection>
    </div>
  );
}
