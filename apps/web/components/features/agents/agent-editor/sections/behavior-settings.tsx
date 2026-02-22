'use client';

import { Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useAgentEditor } from '../agent-editor-context';
import { FormSection } from '../form-section';
import { ColorPicker } from '../color-picker';

export function BehaviorSettings() {
  const { formData, updateFormData, themeData, updateThemeData } = useAgentEditor();

  const starters = themeData.starters;

  const addStarter = () => {
    if (starters.length >= 4) return;
    updateThemeData('starters', [...starters, { text: '', message: '' }]);
  };

  const removeStarter = (index: number) => {
    updateThemeData(
      'starters',
      starters.filter((_, i) => i !== index),
    );
  };

  const updateStarter = (index: number, field: 'text' | 'message', value: string) => {
    const updated = starters.map((s, i) => (i === index ? { ...s, [field]: value } : s));
    updateThemeData('starters', updated);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Behavior</h3>
        <p className="text-sm text-muted-foreground">
          Greeting, conversational starters, bubble notification, and animations
        </p>
      </div>

      {/* Greeting */}
      <FormSection title="Greeting" description="Initial message displayed when the chat opens">
        <div className="grid grid-cols-3 items-start gap-4">
          <Label className="pt-2 text-sm font-medium">Greeting Message</Label>
          <Textarea
            value={formData.welcomeMessage}
            onChange={(e) => updateFormData('welcomeMessage', e.target.value)}
            placeholder="Hello! How can I help you today?"
            rows={3}
            className="col-span-2"
          />
        </div>
      </FormSection>

      {/* Conversational Starters */}
      <FormSection
        title="Conversational Starters"
        description="Quick reply buttons shown on chat open (max 4)"
      >
        {starters.map((starter, index) => (
          <div key={index} className="flex items-start gap-2 rounded-lg border p-3">
            <div className="flex-1 space-y-2">
              <Input
                value={starter.text}
                onChange={(e) => updateStarter(index, 'text', e.target.value)}
                placeholder="Button text"
              />
              <Input
                value={starter.message}
                onChange={(e) => updateStarter(index, 'message', e.target.value)}
                placeholder="Message to send"
              />
            </div>
            <Button variant="ghost" size="icon" onClick={() => removeStarter(index)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {starters.length < 4 && (
          <Button variant="outline" onClick={addStarter} className="w-full">
            <Plus className="mr-2 h-4 w-4" /> Add Starter
          </Button>
        )}
      </FormSection>

      {/* Bubble Notification */}
      <FormSection title="Bubble Notification" description="Auto-popup message on widget icon">
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
                className="col-span-2"
              />
            </div>

            <div className="grid grid-cols-3 items-center gap-4">
              <Label className="text-sm font-medium">Background Color</Label>
              <ColorPicker
                value={themeData.bubble.backgroundColor}
                onChange={(color) => updateThemeData('bubble.backgroundColor', color)}
                className="col-span-2"
              />
            </div>

            <div className="grid grid-cols-3 items-center gap-4">
              <Label className="text-sm font-medium">Text Color</Label>
              <ColorPicker
                value={themeData.bubble.textColor}
                onChange={(color) => updateThemeData('bubble.textColor', color)}
                className="col-span-2"
              />
            </div>

            <div className="grid grid-cols-3 items-center gap-4">
              <Label className="text-sm font-medium">Delay (ms)</Label>
              <Input
                type="number"
                value={themeData.bubble.delayMs}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  updateThemeData('bubble.delayMs', Number.isNaN(val) ? 0 : Math.min(30000, Math.max(0, val)));
                }}
                className="col-span-2"
                min={0}
                max={30000}
                step={500}
              />
            </div>
          </>
        )}
      </FormSection>

      {/* Animations */}
      <FormSection title="Animations" description="Typing indicator and transition speed">
        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Typing Indicator</Label>
          <div className="col-span-2">
            <Switch
              checked={themeData.animations.showTypingIndicator}
              onCheckedChange={(checked) =>
                updateThemeData('animations.showTypingIndicator', checked)
              }
            />
          </div>
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Transition Duration (ms)</Label>
          <Input
            type="number"
            value={themeData.animations.transitionDuration}
            onChange={(e) => {
              const val = parseInt(e.target.value);
              updateThemeData('animations.transitionDuration', Number.isNaN(val) ? 0 : Math.min(1000, Math.max(0, val)));
            }}
            className="col-span-2"
            min={0}
            max={1000}
            step={50}
          />
        </div>
      </FormSection>
    </div>
  );
}
