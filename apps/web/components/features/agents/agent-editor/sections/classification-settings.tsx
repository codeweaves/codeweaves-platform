'use client';

import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { SearchableMultiSelect } from '@/components/ui/searchable-multi-select';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { useAgentEditor } from '../agent-editor-context';

// Mirror the validation schema (`categoryKeywordsSchema`) — must stay in sync.
// Server-side validation is authoritative; the client-side caps just stop
// abuse before a round-trip.
const MAX_CATEGORIES = 24;
const MAX_CATEGORY_LENGTH = 60;
const MAX_LANGUAGES = 15;

// Mirror `supportedLanguageEnum` from `@repo/validation`. Kept here (rather
// than imported) so the agent-editor doesn't pull the entire validation
// package's bundle just for a list of language labels. If a code is added
// to the Zod enum, mirror it here.
const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'hinglish', label: 'Hinglish (Hindi-English mix)' },
  { value: 'mr', label: 'Marathi' },
  { value: 'bn', label: 'Bengali' },
  { value: 'ta', label: 'Tamil' },
  { value: 'te', label: 'Telugu' },
  { value: 'gu', label: 'Gujarati' },
  { value: 'pa', label: 'Punjabi' },
  { value: 'kn', label: 'Kannada' },
  { value: 'ml', label: 'Malayalam' },
  { value: 'ur', label: 'Urdu' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'it', label: 'Italian' },
  { value: 'nl', label: 'Dutch' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ar', label: 'Arabic' },
  { value: 'ru', label: 'Russian' },
];

export function ClassificationSettings() {
  const { formData, updateFormData } = useAgentEditor();
  const [draft, setDraft] = useState('');
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const categories = formData.categoryKeywords;
  const languages = formData.supportedLanguages;

  function addCategory(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_CATEGORY_LENGTH) {
      setCategoryError(`Categories must be at most ${MAX_CATEGORY_LENGTH} characters.`);
      return;
    }
    if (categories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      setCategoryError(`"${trimmed}" is already in the list.`);
      return;
    }
    if (categories.length >= MAX_CATEGORIES) {
      setCategoryError(`At most ${MAX_CATEGORIES} categories per agent.`);
      return;
    }
    updateFormData('categoryKeywords', [...categories, trimmed]);
    setDraft('');
    setCategoryError(null);
  }

  function removeCategory(index: number) {
    updateFormData(
      'categoryKeywords',
      categories.filter((_, i) => i !== index),
    );
  }

  function handleCategoryKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addCategory(draft);
    } else if (e.key === 'Backspace' && draft === '' && categories.length > 0) {
      // Convenience: backspace on an empty input pops the last chip.
      removeCategory(categories.length - 1);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-1.5">
          <h3 className="text-lg font-semibold">Classification</h3>
          <InfoTooltip
            label="Classification"
            content={
              <>
                <p>
                  After a conversation ends, an AI classifier tags it with one of your
                  categories and detects its language.
                </p>
                <p>
                  Both are optional — leave the relevant list empty to skip that
                  dimension entirely. <strong>No LLM call, no spend.</strong>
                </p>
              </>
            }
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Tag finished conversations by topic and language.
        </p>
      </div>

      {/* ── Categories ─────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Label className="text-sm font-medium">Conversation categories</Label>
          <InfoTooltip
            label="Conversation categories"
            content={
              <>
                <p>
                  Topics this agent fields — e.g. <em>Pricing</em>, <em>Support</em>,{' '}
                  <em>Refunds</em>. The classifier picks exactly one per conversation.
                </p>
                <p>
                  Press <code>Enter</code> or <code>,</code> to add. Click the X on a
                  chip to remove it.
                </p>
              </>
            }
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Topics this agent fields.
        </p>
        <div className="flex flex-wrap gap-2 rounded-md border bg-background p-2 min-h-12">
          {categories.map((category, index) => (
            <Badge
              key={`${category}-${index}`}
              variant="secondary"
              className="gap-1 pl-2 pr-1 text-xs"
            >
              {category}
              <button
                type="button"
                onClick={() => removeCategory(index)}
                className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground"
                aria-label={`Remove category ${category}`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          <Input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (categoryError) setCategoryError(null);
            }}
            onKeyDown={handleCategoryKeyDown}
            onBlur={() => {
              if (draft.trim()) addCategory(draft);
            }}
            placeholder={
              categories.length === 0
                ? 'Type a category and press Enter…'
                : 'Add another…'
            }
            className="min-w-40 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {categories.length} / {MAX_CATEGORIES}
          </span>
          {categoryError && <span className="text-destructive">{categoryError}</span>}
        </div>
      </div>

      {/* ── Languages ──────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Label className="text-sm font-medium">Supported languages</Label>
          <InfoTooltip
            label="Supported languages"
            content={
              <>
                <p>
                  Conversations in languages outside this list are tagged{' '}
                  <strong>Other</strong>, so you can spot unmet demand.
                </p>
                <p>
                  <strong>Hinglish</strong> is code-mixed Hindi-English in Latin
                  script — pick it alongside English and Hindi if your audience uses
                  it.
                </p>
              </>
            }
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Languages you want tracked.
        </p>
        <SearchableMultiSelect
          triggerClassName="w-full max-w-md"
          placeholder="No languages selected — detection disabled"
          searchPlaceholder="Search languages..."
          emptyMessage="No matching language"
          values={languages}
          onValuesChange={(v) => {
            // Cap server-side too, but stop here to avoid the round-trip.
            if (v.length > MAX_LANGUAGES) return;
            updateFormData('supportedLanguages', v);
          }}
          selectedLabel={(n) => `${n} languages`}
          options={LANGUAGE_OPTIONS}
        />
        <div className="text-xs text-muted-foreground">
          {languages.length} / {MAX_LANGUAGES}
          {languages.length === 0 && (
            <span className="ml-2">
              · language detection is currently <strong>off</strong> for this
              agent
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
