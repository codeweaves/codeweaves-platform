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

  const fallbackPhrases = formData.fallbackPhrases;

  const addFallbackPhrase = () => {
    if (fallbackPhrases.length >= 3) return;
    updateFormData('fallbackPhrases', [...fallbackPhrases, '']);
  };

  const removeFallbackPhrase = (index: number) => {
    updateFormData(
      'fallbackPhrases',
      fallbackPhrases.filter((_, i) => i !== index),
    );
  };

  const updateFallbackPhrase = (index: number, value: string) => {
    if (value.length > 200) return;
    updateFormData(
      'fallbackPhrases',
      fallbackPhrases.map((p, i) => (i === index ? value : p)),
    );
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

          <div className="space-y-2 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label
                  htmlFor="session-lifetime-hours"
                  className="text-sm font-medium"
                >
                  Session lifetime (hours)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Max length of a single chat session, measured from when it
                  started. After this, the visitor&apos;s next message begins a new
                  session (the old one closes). Range 6–24.
                </p>
              </div>
              <Input
                id="session-lifetime-hours"
                type="number"
                min={6}
                max={24}
                step={1}
                value={formData.sessionLifetimeHours}
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  if (!Number.isFinite(raw)) return;
                  const clamped = Math.min(24, Math.max(6, Math.round(raw)));
                  updateFormData('sessionLifetimeHours', clamped);
                }}
                className="w-20 text-center"
              />
            </div>
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

      <FormSection
        title="Fallback Phrases"
        description="What the agent says when it can't answer from its knowledge. Replies matching these are tracked as the 'couldn't answer' rate in analytics (max 3)."
      >
        <div className="space-y-4">
          {fallbackPhrases.map((phrase, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  value={phrase}
                  onChange={(e) => updateFallbackPhrase(index, e.target.value)}
                  placeholder="e.g. I'm not sure about that — let me connect you with our team."
                  maxLength={200}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  {phrase.length}/200
                </span>
              </div>
              <Button variant="ghost" size="icon" onClick={() => removeFallbackPhrase(index)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}

          {fallbackPhrases.length < 3 && (
            <Button variant="outline" onClick={addFallbackPhrase} className="w-full">
              <Plus className="mr-2 h-4 w-4" /> Add Fallback Phrase
            </Button>
          )}

          {fallbackPhrases.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              <p className="text-sm">No fallback phrases added yet.</p>
              <p className="mt-1 text-xs">
                Add phrases the agent uses when it can&apos;t answer, so the
                &quot;couldn&apos;t answer&quot; rate can be tracked.
              </p>
            </div>
          )}
        </div>
      </FormSection>
    </div>
  );
}
