'use client';

import { Plus, X } from 'lucide-react';
import {
  DATA_FIELD_TYPES,
  MAX_DATA_FIELDS,
  type DataFieldType,
} from '@repo/validation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ToggleRow } from '../toggle-row';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useAgentEditor,
  type EditorDataField,
} from '../agent-editor-context';
import { FormSection } from '../form-section';

/** Friendly labels for each stored field type. */
const TYPE_LABELS: Record<DataFieldType, string> = {
  STRING: 'Text',
  NUMBER: 'Number',
  BOOLEAN: 'Yes / No',
  DATE: 'Date',
  EMAIL: 'Email',
  PHONE: 'Phone',
};

/** Derive a safe machine key from a human label. May be empty for odd input. */
function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '') // keys must start with a letter
    .replace(/_+$/g, '');
}

export function DataCaptureSettings() {
  const { formData, updateFormData, fieldErrors, setFieldErrors, clearFieldError } =
    useAgentEditor();

  const fields = formData.dataFields;

  const setFields = (next: EditorDataField[]) =>
    updateFormData('dataFields', next);

  const addField = () => {
    if (fields.length >= MAX_DATA_FIELDS) return;
    setFields([
      ...fields,
      { key: '', label: '', type: 'STRING', required: false, description: null },
    ]);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
    // Drop any data-field errors — they re-validate on the next save attempt.
    setFieldErrors(
      Object.fromEntries(
        Object.entries(fieldErrors).filter(
          ([k]) => !k.startsWith('dataFields.'),
        ),
      ),
    );
  };

  const updateLabel = (index: number, value: string) => {
    const field = fields[index];
    if (!field) return;
    // Keep the key in sync with the label until the user hand-edits the key.
    const wasAuto = field.key === '' || field.key === slugify(field.label);
    const next = fields.map((f, i) =>
      i === index
        ? { ...f, label: value, key: wasAuto ? slugify(value) : f.key }
        : f,
    );
    setFields(next);
    clearFieldError(`dataFields.${index}.label`);
    if (wasAuto) clearFieldError(`dataFields.${index}.key`);
  };

  const updateKey = (index: number, value: string) => {
    const sanitized = value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    setFields(
      fields.map((f, i) => (i === index ? { ...f, key: sanitized } : f)),
    );
    clearFieldError(`dataFields.${index}.key`);
  };

  const updateField = <K extends keyof EditorDataField>(
    index: number,
    key: K,
    value: EditorDataField[K],
  ) => {
    setFields(fields.map((f, i) => (i === index ? { ...f, [key]: value } : f)));
  };

  return (
    <div className="space-y-6">
      <FormSection
        title="Data Capture"
        description="What this agent should collect from a conversation."
        info={
          <>
            <p>
              Define the fields to pull out of a chat — e.g. name, email and phone for
              a sales bot, or an employee ID for HR.
            </p>
            <p>
              Capture runs automatically in the background <strong>after</strong> a
              conversation ends, so it never slows down replies.
            </p>
            <p>Leave empty to collect nothing.</p>
          </>
        }
      >
        <div className="space-y-4">
          {fields.length === 0 && (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No fields yet. Add one to start capturing data from conversations.
            </p>
          )}

          {fields.map((field, index) => {
            const labelError = fieldErrors[`dataFields.${index}.label`];
            const keyError = fieldErrors[`dataFields.${index}.key`];
            return (
              <div
                key={index}
                className="space-y-3 rounded-lg border bg-background p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs font-medium">Label</Label>
                    <Input
                      value={field.label}
                      onChange={(e) => updateLabel(index, e.target.value)}
                      placeholder="e.g. Email address"
                      maxLength={100}
                      aria-invalid={labelError ? true : undefined}
                    />
                    {labelError && (
                      <p className="text-xs text-destructive">{labelError}</p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeField(index)}
                    aria-label={`Remove field ${field.label || index + 1}`}
                    className="mt-5 shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Key</Label>
                    <Input
                      value={field.key}
                      onChange={(e) => updateKey(index, e.target.value)}
                      placeholder="email"
                      maxLength={64}
                      className="font-mono text-sm"
                      aria-invalid={keyError ? true : undefined}
                    />
                    {keyError && (
                      <p className="text-xs text-destructive">{keyError}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Type</Label>
                    <Select
                      value={field.type}
                      onValueChange={(v) =>
                        updateField(index, 'type', v as DataFieldType)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DATA_FIELD_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {TYPE_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-medium">
                    Hint{' '}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    value={field.description ?? ''}
                    onChange={(e) =>
                      updateField(
                        index,
                        'description',
                        e.target.value || null,
                      )
                    }
                    placeholder="Helps extraction, e.g. the 6-digit order number"
                    maxLength={500}
                  />
                </div>

                <div className="rounded-md border p-3">
                  <ToggleRow
                    id={`dataFieldRequired-${index}`}
                    label="Required"
                    info={
                      <p>
                        The agent will politely ask for this if the visitor doesn&apos;t
                        provide it on their own.
                      </p>
                    }
                    checked={field.required}
                    onChange={(checked) => updateField(index, 'required', checked)}
                  />
                </div>
              </div>
            );
          })}

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {fields.length} / {MAX_DATA_FIELDS}
            </span>
            {fields.length < MAX_DATA_FIELDS && (
              <Button variant="outline" onClick={addField}>
                <Plus className="mr-2 h-4 w-4" /> Add Field
              </Button>
            )}
          </div>
        </div>
      </FormSection>
    </div>
  );
}
