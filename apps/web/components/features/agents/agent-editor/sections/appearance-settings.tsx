'use client';

import { useState } from 'react';
import { CornerDownLeft, CornerDownRight, Palette, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAgentEditor } from '../agent-editor-context';
import { FormSection } from '../form-section';
import { ColorPicker } from '../color-picker';
import { TabGroup } from '../tab-group';

const appearanceTabs = [
  { id: 'icon', label: 'Chat Icon', icon: <Palette className="w-4 h-4" /> },
  { id: 'bubble', label: 'Bubble Prompt', icon: <MessageCircle className="w-4 h-4" /> },
];

export function AppearanceSettings() {
  const { themeData, updateThemeData } = useAgentEditor();
  const [activeTab, setActiveTab] = useState('icon');

  const renderIconSettings = () => (
    <div className="space-y-6">
      <ColorPicker
        label="Icon Background Color"
        value={themeData.icon.backgroundColor}
        onChange={(color) => updateThemeData('icon.backgroundColor', color)}
        id="iconBg"
      />

      <div className="grid grid-cols-3 gap-4 items-center">
        <Label className="text-sm font-medium text-gray-700">Icon Border Radius (px)</Label>
        <Input
          type="number"
          value={themeData.icon.borderRadius}
          onChange={(e) => updateThemeData('icon.borderRadius', parseInt(e.target.value) || 14)}
          min={0}
          max={50}
          className="col-span-2 rounded-md focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="space-y-3">
        <Label className="text-sm font-medium text-gray-700">Icon Position</Label>
        <div className="flex gap-3">
          <Button
            variant={themeData.icon.position === 'left' ? 'default' : 'outline'}
            onClick={() => updateThemeData('icon.position', 'left')}
            className="flex-1 flex items-center justify-center gap-2 h-12"
          >
            <CornerDownLeft className="w-4 h-4" />
            Bottom Left
          </Button>
          <Button
            variant={themeData.icon.position === 'right' ? 'default' : 'outline'}
            onClick={() => updateThemeData('icon.position', 'right')}
            className="flex-1 flex items-center justify-center gap-2 h-12"
          >
            <CornerDownRight className="w-4 h-4" />
            Bottom Right
          </Button>
        </div>
      </div>
    </div>
  );

  const renderBubbleSettings = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4 items-center">
        <Label className="text-sm font-medium text-gray-700">Bubble Text</Label>
        <Input
          value={themeData.bubble.text}
          onChange={(e) => updateThemeData('bubble.text', e.target.value)}
          placeholder="Need help?"
          className="col-span-2 rounded-md focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <ColorPicker
        label="Bubble Background Color"
        value={themeData.bubble.backgroundColor}
        onChange={(color) => updateThemeData('bubble.backgroundColor', color)}
        id="bubbleBg"
      />

      <ColorPicker
        label="Bubble Text Color"
        value={themeData.bubble.textColor}
        onChange={(color) => updateThemeData('bubble.textColor', color)}
        id="bubbleTextColor"
      />

      <div className="grid grid-cols-3 gap-4 items-center">
        <Label className="text-sm font-medium text-gray-700">Show Delay (seconds)</Label>
        <Input
          type="number"
          value={Math.round(themeData.bubble.delayMs / 1000)}
          onChange={(e) => {
            const seconds = parseInt(e.target.value);
            updateThemeData('bubble.delayMs', Number.isNaN(seconds) ? 0 : Math.min(30, Math.max(0, seconds)) * 1000);
          }}
          min={0}
          max={30}
          className="col-span-2 rounded-md focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
        <div>
          <Label className="text-sm font-medium text-gray-700">Enable Bubble</Label>
          <p className="text-xs text-gray-500 mt-1">Show a prompt bubble near the chat icon</p>
        </div>
        <Switch
          checked={themeData.bubble.enabled}
          onCheckedChange={(checked) => updateThemeData('bubble.enabled', checked)}
        />
      </div>
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
