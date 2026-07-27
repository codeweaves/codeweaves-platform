'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAgentEditor } from '../agent-editor-context';
import { FormSection } from '../form-section';
import { ColorPicker } from '../color-picker';

/** Mirrors the backend cap in `handoverEmailRecipientsSchema`. */
const MAX_RECIPIENTS = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </Label>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function HumanHandoverSettings() {
  const { formData, updateFormData, themeData, updateThemeData } = useAgentEditor();
  const enabled = formData.humanTakeoverEnabled;
  const showButton = formData.showTalkToHumanButton;
  const emailEnabled = formData.handoverEmailEnabled;
  const handover = themeData.handover;

  return (
    <FormSection
      title="Human Handover"
      description="Let a teammate take over a live chat from the AI when a visitor needs a human. The AI pauses while a person is replying, then resumes when the chat is resolved."
    >
      <ToggleRow
        id="humanTakeoverEnabled"
        label="Enable human takeover"
        description="Flag chats that need a human in your Inbox, and let teammates take over."
        checked={enabled}
        onChange={(v) => updateFormData('humanTakeoverEnabled', v)}
      />

      {enabled && (
        <>
          {/* Connected notice */}
          <div className="space-y-4 border-t pt-6">
            <div className="space-y-2">
              <Label htmlFor="humanConnectedLabel" className="text-sm font-medium text-foreground">
                Connected message
              </Label>
              <p className="text-sm text-muted-foreground">
                Shown to the visitor on the divider line when a teammate joins. Leave blank for a
                sensible default.
              </p>
              <Input
                id="humanConnectedLabel"
                value={formData.humanConnectedLabel}
                onChange={(e) => updateFormData('humanConnectedLabel', e.target.value)}
                placeholder="You're now connected with our team"
                maxLength={160}
              />
            </div>
            <ColorPicker
              label="Connected line color"
              value={handover.connectedLineColor}
              onChange={(color) => updateThemeData('handover.connectedLineColor', color)}
              id="handoverLineColor"
            />
          </div>

          {/* Connecting notice (while a teammate is being connected) */}
          <div className="space-y-4 border-t pt-6">
            <div className="space-y-2">
              <Label htmlFor="handoverRequestedLabel" className="text-sm font-medium text-foreground">
                Connecting message
              </Label>
              <p className="text-sm text-muted-foreground">
                Shown to the visitor while a teammate is being connected — before anyone takes over.
              </p>
              <Input
                id="handoverRequestedLabel"
                value={handover.requestedLabel}
                onChange={(e) => updateThemeData('handover.requestedLabel', e.target.value)}
                placeholder="Connecting you with our team. Someone will be with you shortly."
                maxLength={160}
              />
            </div>
            <ColorPicker
              label="Connecting line color"
              value={handover.requestedLineColor}
              onChange={(color) => updateThemeData('handover.requestedLineColor', color)}
              id="handoverRequestedLineColor"
            />
          </div>

          {/* Handed-back notice (teammate resolved/left, AI resumes) */}
          <div className="space-y-4 border-t pt-6">
            <div className="space-y-2">
              <Label htmlFor="handoverEndedLabel" className="text-sm font-medium text-foreground">
                Handed-back message
              </Label>
              <p className="text-sm text-muted-foreground">
                Shown to the visitor when the teammate resolves the chat and the AI takes back over.
              </p>
              <Input
                id="handoverEndedLabel"
                value={handover.endedLabel}
                onChange={(e) => updateThemeData('handover.endedLabel', e.target.value)}
                placeholder="You're back with our assistant"
                maxLength={160}
              />
            </div>
            <ColorPicker
              label="Handed-back line color"
              value={handover.endedLineColor}
              onChange={(color) => updateThemeData('handover.endedLineColor', color)}
              id="handoverEndedLineColor"
            />
          </div>

          {/* Talk to a human button */}
          <div className="space-y-4 border-t pt-6">
            <ToggleRow
              id="showTalkToHumanButton"
              label='Show "Talk to a human" button'
              description="Adds a button in the chat header so visitors can ask for a person directly."
              checked={showButton}
              onChange={(v) => updateFormData('showTalkToHumanButton', v)}
            />

            {showButton && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="handoverButtonLabel" className="text-sm font-medium text-foreground">
                    Button tooltip
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    The button is a headset icon next to send; this text shows when the visitor
                    hovers it.
                  </p>
                  <Input
                    id="handoverButtonLabel"
                    value={handover.buttonLabel}
                    onChange={(e) => updateThemeData('handover.buttonLabel', e.target.value)}
                    placeholder="Talk to a human"
                    maxLength={40}
                  />
                </div>
                <ColorPicker
                  label="Icon background"
                  value={handover.buttonBackgroundColor}
                  onChange={(color) => updateThemeData('handover.buttonBackgroundColor', color)}
                  id="handoverButtonBg"
                />
                <ColorPicker
                  label="Icon & border color"
                  value={handover.buttonTextColor}
                  onChange={(color) => updateThemeData('handover.buttonTextColor', color)}
                  id="handoverButtonText"
                />
              </div>
            )}
          </div>

          {/* Email notification */}
          <div className="space-y-4 border-t pt-6">
            <ToggleRow
              id="handoverEmailEnabled"
              label="Email the team when a visitor asks for a human"
              description="Sent immediately. The in-app alert, sound and browser popup always fire — this is the email on top."
              checked={emailEnabled}
              onChange={(v) => updateFormData('handoverEmailEnabled', v)}
            />

            {emailEnabled && (
              <EmailRecipientsField
                recipients={formData.handoverEmailRecipients}
                onChange={(next) => updateFormData('handoverEmailRecipients', next)}
              />
            )}
          </div>
        </>
      )}
    </FormSection>
  );
}

/**
 * Recipient list for the handover email.
 *
 * Empty is a meaningful, documented state (everyone in the org), so the empty
 * case gets explicit helper text rather than reading as "not configured yet".
 */
function EmailRecipientsField({
  recipients,
  onChange,
}: {
  recipients: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const email = draft.trim().toLowerCase();
    if (!email) return;
    if (!EMAIL_RE.test(email)) {
      setError('Enter a valid email address');
      return;
    }
    if (recipients.includes(email)) {
      setError('That address is already on the list');
      return;
    }
    if (recipients.length >= MAX_RECIPIENTS) {
      setError(`At most ${MAX_RECIPIENTS} addresses`);
      return;
    }
    onChange([...recipients, email]);
    setDraft('');
    setError(null);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="handoverEmailRecipients" className="text-sm font-medium text-foreground">
        Send to
      </Label>
      <p className="text-sm text-muted-foreground">
        Leave empty to email everyone in your organization. Add addresses to send
        to a shared inbox instead — useful for people without a dashboard login.
      </p>

      {recipients.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-1">
          {recipients.map((email) => (
            <span
              key={email}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-foreground"
            >
              {email}
              <button
                type="button"
                onClick={() => onChange(recipients.filter((e) => e !== email))}
                aria-label={`Remove ${email}`}
                className="text-muted-foreground transition-colors hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input
          id="handoverEmailRecipients"
          type="email"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            // Enter must not bubble into a form submit — this is an
            // add-to-list action, not a save.
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="support@yourcompany.com"
          maxLength={200}
        />
        <Button type="button" variant="outline" onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
