'use client';

import { Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useAgentEditor } from '../agent-editor-context';
import { FormSection } from '../form-section';

export function BehaviorSettings() {
  const { formData, updateFormData, themeData, updateThemeData } = useAgentEditor();

  const starters = themeData.starters;

  const addStarter = () => {
    if (starters.length >= 4) return;
    updateThemeData('starters', [...starters, { message: '' }]);
  };

  const removeStarter = (index: number) => {
    updateThemeData(
      'starters',
      starters.filter((_, i) => i !== index),
    );
  };

  const updateStarter = (index: number, value: string) => {
    if (value.length > 80) return;
    const updated = starters.map((s, i) => (i === index ? { message: value } : s));
    updateThemeData('starters', updated);
  };

  return (
    <div className="space-y-6">
      <FormSection
        title="Agent Behavior"
        description="Configure how your agent interacts with users"
      >
        <div className="space-y-6">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Greeting Message</Label>
            <Textarea
              value={formData.welcomeMessage}
              onChange={(e) => updateFormData('welcomeMessage', e.target.value)}
              placeholder="Hello! How can I help you today?"
              rows={3}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label className="text-sm font-medium">Typing Indicator</Label>
              <p className="text-xs text-muted-foreground">
                Show typing animation when AI is responding
              </p>
            </div>
            <Switch
              checked={themeData.animations.showTypingIndicator}
              onCheckedChange={(checked) =>
                updateThemeData('animations.showTypingIndicator', checked)
              }
            />
          </div>
        </div>
      </FormSection>

      <FormSection
        title="Conversation Starters"
        description="Quick reply buttons to help users start conversations (max 4)"
      >
        <div className="space-y-4">
          {starters.map((starter, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  value={starter.message}
                  onChange={(e) => updateStarter(index, e.target.value)}
                  placeholder="e.g. What services do you offer?"
                  maxLength={80}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  {starter.message.length}/80
                </span>
              </div>
              <Button variant="ghost" size="icon" onClick={() => removeStarter(index)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}

          {starters.length < 4 && (
            <Button variant="outline" onClick={addStarter} className="w-full">
              <Plus className="mr-2 h-4 w-4" /> Add Conversation Starter
            </Button>
          )}

          {starters.length >= 4 && (
            <p className="text-xs text-muted-foreground">
              Maximum 4 starters allowed.
            </p>
          )}

          {starters.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              <p className="text-sm">No conversation starters added yet.</p>
              <p className="mt-1 text-xs">
                Add some to help users start conversations easily.
              </p>
            </div>
          )}
        </div>
      </FormSection>
    </div>
  );
}
