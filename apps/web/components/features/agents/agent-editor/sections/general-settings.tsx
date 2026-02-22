'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAgentEditor } from '../agent-editor-context';
import { FormSection } from '../form-section';
import { ColorPicker } from '../color-picker';
import { TabGroup } from '../tab-group';
import { useProfile } from '@/hooks/use-profile';

const FONT_OPTIONS = [
  { value: 'Inter, system-ui, sans-serif', label: 'Inter' },
  { value: 'Roboto, sans-serif', label: 'Roboto' },
  { value: "'Open Sans', sans-serif", label: 'Open Sans' },
  { value: 'Lato, sans-serif', label: 'Lato' },
  { value: 'Poppins, sans-serif', label: 'Poppins' },
  { value: 'system-ui, sans-serif', label: 'System Default' },
];

const POSITION_TABS = [
  { id: 'right', label: 'Right' },
  { id: 'left', label: 'Left' },
];

export function GeneralSettings() {
  const { agent, formData, updateFormData, themeData, updateThemeData } =
    useAgentEditor();
  const { profile } = useProfile();
  const isAdmin =
    profile?.role === 'SUPER_ADMIN' || profile?.role === 'ADMIN';

  const handlePositionChange = (position: string) => {
    updateThemeData('icon.position', position);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">General</h3>
        <p className="text-sm text-muted-foreground">
          Basic details, widget position, typography, and icon styling
        </p>
      </div>

      {/* Agent identity */}
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

      {/* Widget Position */}
      <FormSection title="Widget Position" description="Choose which side of the screen the chat icon appears">
        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Position</Label>
          <div className="col-span-2">
            <TabGroup
              tabs={POSITION_TABS}
              value={themeData.icon.position}
              onChange={handlePositionChange}
              aria-label="Widget position"
            />
          </div>
        </div>
      </FormSection>

      {/* Typography */}
      <FormSection title="Typography" description="Font family and size for the chat widget">
        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Font Family</Label>
          <div className="col-span-2">
            <Select
              value={themeData.typography.fontFamily}
              onValueChange={(val) => updateThemeData('typography.fontFamily', val)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_OPTIONS.map((font) => (
                  <SelectItem key={font.value} value={font.value}>
                    <span style={{ fontFamily: font.value }}>{font.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Base Font Size</Label>
          <div className="col-span-2 flex items-center gap-3">
            <Slider
              value={[themeData.typography.baseFontSize]}
              onValueChange={(vals) => updateThemeData('typography.baseFontSize', vals[0] ?? themeData.typography.baseFontSize)}
              min={12}
              max={20}
              step={1}
              className="flex-1"
            />
            <span className="w-10 text-right text-sm text-muted-foreground">
              {themeData.typography.baseFontSize}px
            </span>
          </div>
        </div>
      </FormSection>

      {/* Icon Appearance */}
      <FormSection title="Icon Appearance" description="Customize the chat launcher button">
        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Background Color</Label>
          <ColorPicker
            value={themeData.icon.backgroundColor}
            onChange={(color) => updateThemeData('icon.backgroundColor', color)}
            className="col-span-2"
          />
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Hover Color</Label>
          <ColorPicker
            value={themeData.icon.hoverBackgroundColor}
            onChange={(color) => updateThemeData('icon.hoverBackgroundColor', color)}
            className="col-span-2"
          />
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Size</Label>
          <div className="col-span-2 flex items-center gap-3">
            <Slider
              value={[themeData.icon.size]}
              onValueChange={(vals) => updateThemeData('icon.size', vals[0] ?? themeData.icon.size)}
              min={40}
              max={80}
              step={2}
              className="flex-1"
            />
            <span className="w-10 text-right text-sm text-muted-foreground">
              {themeData.icon.size}px
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Border Radius</Label>
          <div className="col-span-2 flex items-center gap-3">
            <Slider
              value={[themeData.icon.borderRadius]}
              onValueChange={(vals) => updateThemeData('icon.borderRadius', vals[0] ?? themeData.icon.borderRadius)}
              min={0}
              max={50}
              step={1}
              className="flex-1"
            />
            <span className="w-10 text-right text-sm text-muted-foreground">
              {themeData.icon.borderRadius}%
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Shadow</Label>
          <Input
            value={themeData.icon.shadow}
            onChange={(e) => updateThemeData('icon.shadow', e.target.value)}
            placeholder="0 4px 12px rgba(0,0,0,0.15)"
            className="col-span-2"
          />
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Custom Image URL</Label>
          <Input
            value={themeData.icon.customImageUrl ?? ''}
            onChange={(e) =>
              updateThemeData('icon.customImageUrl', e.target.value || undefined)
            }
            placeholder="https://example.com/icon.png (optional)"
            className="col-span-2"
          />
        </div>
      </FormSection>
    </div>
  );
}
