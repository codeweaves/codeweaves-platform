'use client';

import { useState } from 'react';
import { Palette, MessageCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { useAgentEditor } from '../agent-editor-context';
import { FormSection } from '../form-section';
import { ColorPicker } from '../color-picker';
import { TabGroup } from '../tab-group';
import { ImageUpload } from '../image-upload';

const appearanceTabs = [
  { id: 'icon', label: 'Chat Icon', icon: <Palette className="h-4 w-4" /> },
  { id: 'bubble', label: 'Bubble Prompt', icon: <MessageCircle className="h-4 w-4" /> },
];

export function AppearanceSettings() {
  const { agent, themeData, updateThemeData } = useAgentEditor();
  const [activeTab, setActiveTab] = useState('icon');

  const renderIconSettings = () => (
    <div className="space-y-6">
      <ColorPicker
        label="Icon Background Color"
        value={themeData.icon.backgroundColor}
        onChange={(color) => updateThemeData('icon.backgroundColor', color)}
      />

      <div className="grid grid-cols-3 items-center gap-4">
        <Label className="text-sm font-medium">Icon Border Radius</Label>
        <div className="col-span-2 flex items-center gap-3">
          <Slider
            value={[themeData.icon.borderRadius]}
            onValueChange={(vals) =>
              updateThemeData('icon.borderRadius', vals[0] ?? themeData.icon.borderRadius)
            }
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

      <div className="space-y-3">
        <Label className="text-sm font-medium">Icon Position</Label>
        <div className="flex gap-3">
          <Button
            variant={themeData.icon.position === 'left' ? 'default' : 'outline'}
            onClick={() => updateThemeData('icon.position', 'left')}
            className="h-12 flex-1"
          >
            Bottom Left
          </Button>
          <Button
            variant={themeData.icon.position === 'right' ? 'default' : 'outline'}
            onClick={() => updateThemeData('icon.position', 'right')}
            className="h-12 flex-1"
          >
            Bottom Right
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 items-center gap-4">
        <Label className="text-sm font-medium">Icon Size</Label>
        <div className="col-span-2 flex items-center gap-3">
          <Slider
            value={[themeData.icon.size]}
            onValueChange={(vals) =>
              updateThemeData('icon.size', vals[0] ?? themeData.icon.size)
            }
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
        <Label className="text-sm font-medium">Shadow</Label>
        <Input
          value={themeData.icon.shadow}
          onChange={(e) => updateThemeData('icon.shadow', e.target.value)}
          placeholder="0 4px 12px rgba(0,0,0,0.15)"
          className="col-span-2"
        />
      </div>

      <div className="grid grid-cols-3 items-start gap-4">
        <Label className="pt-2 text-sm font-medium">Custom Icon Image</Label>
        <div className="col-span-2">
          <ImageUpload
            value={themeData.icon.customImageUrl}
            onUpload={(url) => updateThemeData('icon.customImageUrl', url)}
            onRemove={() => updateThemeData('icon.customImageUrl', undefined)}
            agentId={agent.id}
            purpose="icon-image"
            previewShape="rounded"
            hint="Upload a custom icon image (optional)"
          />
        </div>
      </div>
    </div>
  );

  const renderBubbleSettings = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-3 items-center gap-4">
        <Label className="text-sm font-medium">Enable Bubble</Label>
        <div className="col-span-2">
          <Switch
            checked={themeData.bubble.enabled}
            onCheckedChange={(checked) => updateThemeData('bubble.enabled', checked)}
          />
        </div>
      </div>

      {themeData.bubble.enabled && (
        <>
          <div className="grid grid-cols-3 items-center gap-4">
            <Label className="text-sm font-medium">Bubble Text</Label>
            <Input
              value={themeData.bubble.text}
              onChange={(e) => updateThemeData('bubble.text', e.target.value)}
              placeholder="Need help?"
              className="col-span-2"
            />
          </div>

          <ColorPicker
            label="Bubble Background Color"
            value={themeData.bubble.backgroundColor}
            onChange={(color) => updateThemeData('bubble.backgroundColor', color)}
          />

          <ColorPicker
            label="Bubble Text Color"
            value={themeData.bubble.textColor}
            onChange={(color) => updateThemeData('bubble.textColor', color)}
          />

          <div className="grid grid-cols-3 items-center gap-4">
            <Label className="text-sm font-medium">Show Delay (ms)</Label>
            <Input
              type="number"
              value={themeData.bubble.delayMs}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                updateThemeData(
                  'bubble.delayMs',
                  Number.isNaN(val) ? 0 : Math.min(30000, Math.max(0, val)),
                );
              }}
              min={0}
              max={30000}
              step={500}
              className="col-span-2"
            />
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <FormSection
        title="Visual Appearance"
        description="Customize how your chat widget looks to visitors"
      >
        <TabGroup
          tabs={appearanceTabs}
          value={activeTab}
          onChange={setActiveTab}
          aria-label="Appearance section"
        />

        {activeTab === 'icon' && renderIconSettings()}
        {activeTab === 'bubble' && renderBubbleSettings()}
      </FormSection>
    </div>
  );
}
