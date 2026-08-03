'use client';

import { Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAgentEditor } from '../agent-editor-context';
import { FormSection } from '../form-section';
import { FieldLabel } from '../field-label';

/**
 * After removing item `removedIndex` from a list, shift its inline field-error
 * keys so they keep pointing at the right rows: drop `${prefix}.${removedIndex}`
 * and renumber every higher index down by one. Without this, removing a middle
 * row leaves an error attached to the wrong (now-shifted) field.
 */
function reindexErrorsAfterRemove(
  errors: Record<string, string>,
  prefix: string,
  removedIndex: number,
): Record<string, string> {
  const dot = `${prefix}.`;
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(errors)) {
    if (!key.startsWith(dot)) {
      next[key] = value;
      continue;
    }
    const idx = Number(key.slice(dot.length));
    if (!Number.isInteger(idx) || idx === removedIndex) continue;
    next[`${prefix}.${idx > removedIndex ? idx - 1 : idx}`] = value;
  }
  return next;
}

export function BehaviorSettings() {
  const {
    formData,
    updateFormData,
    themeData,
    updateThemeData,
    fieldErrors,
    setFieldErrors,
    clearFieldError,
  } = useAgentEditor();

  const starters = themeData.starters;

  const addStarter = () => {
    if (starters.length >= 4) return;
    updateThemeData('starters', [...starters, { message: '' }]);
  };

  const removeStarter = (index: number) => {
    setFieldErrors(reindexErrorsAfterRemove(fieldErrors, 'starters', index));
    updateThemeData(
      'starters',
      starters.filter((_, i) => i !== index),
    );
  };

  const updateStarter = (index: number, value: string) => {
    if (value.length > 80) return;
    clearFieldError(`starters.${index}`);
    const updated = starters.map((s, i) => (i === index ? { message: value } : s));
    updateThemeData('starters', updated);
  };

  const fallbackPhrases = formData.fallbackPhrases;

  const addFallbackPhrase = () => {
    if (fallbackPhrases.length >= 3) return;
    updateFormData('fallbackPhrases', [...fallbackPhrases, '']);
  };

  const removeFallbackPhrase = (index: number) => {
    setFieldErrors(reindexErrorsAfterRemove(fieldErrors, 'fallbackPhrases', index));
    updateFormData(
      'fallbackPhrases',
      fallbackPhrases.filter((_, i) => i !== index),
    );
  };

  const updateFallbackPhrase = (index: number, value: string) => {
    if (value.length > 200) return;
    clearFieldError(`fallbackPhrases.${index}`);
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
              <FieldLabel
                htmlFor="session-lifetime-hours"
                label="Session lifetime (hours)"
                description="Range 6&ndash;24."
                info={
                  <>
                    <p>
                      Max length of a single chat session, measured from when it
                      started.
                    </p>
                    <p>
                      After this the old session closes and the visitor&apos;s next
                      message begins a new one. Tighter values produce more
                      &ldquo;distinct conversations&rdquo; in analytics.
                    </p>
                  </>
                }
              />
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
          {starters.map((starter, index) => {
            const error = fieldErrors[`starters.${index}`];
            return (
              <div key={index} className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Input
                      value={starter.message}
                      onChange={(e) => updateStarter(index, e.target.value)}
                      placeholder="e.g. What services do you offer?"
                      maxLength={80}
                      aria-invalid={error ? true : undefined}
                      className={cn(
                        error && 'border-destructive focus-visible:ring-destructive/30',
                      )}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      {starter.message.length}/80
                    </span>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removeStarter(index)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {error && <p className="text-xs text-destructive">{error}</p>}
              </div>
            );
          })}

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
        description="What the agent says when it can't answer (max 3)."
        info={
          <>
            <p>
              Phrases the agent falls back to when it can&apos;t answer from its
              knowledge.
            </p>
            <p>
              Replies that match these are tracked as the{' '}
              <strong>&ldquo;couldn&apos;t answer&rdquo; rate</strong> in analytics, so
              you can see what your knowledge base is missing.
            </p>
          </>
        }
      >
        <div className="space-y-4">
          {fallbackPhrases.map((phrase, index) => {
            const error = fieldErrors[`fallbackPhrases.${index}`];
            return (
              <div key={index} className="flex items-start gap-2">
                <div className="flex-1 space-y-1">
                  <Input
                    value={phrase}
                    onChange={(e) => updateFallbackPhrase(index, e.target.value)}
                    placeholder="e.g. I'm not sure about that, let me connect you with our team."
                    maxLength={200}
                    aria-invalid={error ? true : undefined}
                    className={cn(
                      'w-full',
                      error && 'border-destructive focus-visible:ring-destructive/30',
                    )}
                  />
                  <div className="flex items-center justify-between gap-2">
                    {error ? (
                      <p className="text-xs text-destructive">{error}</p>
                    ) : (
                      <span />
                    )}
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {phrase.length}/200
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeFallbackPhrase(index)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            );
          })}

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
