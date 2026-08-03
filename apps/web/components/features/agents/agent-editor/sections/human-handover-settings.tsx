'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAgentEditor } from '../agent-editor-context';
import { FormSection } from '../form-section';
import { ColorPicker } from '../color-picker';
import { FieldLabel } from '../field-label';
import { ToggleRow } from '../toggle-row';

/** Mirrors the backend cap in `handoverEmailRecipientsSchema`. */
const MAX_RECIPIENTS = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function HumanHandoverSettings() {
  const { formData, updateFormData, themeData, updateThemeData } = useAgentEditor();
  const enabled = formData.humanTakeoverEnabled;
  const showButton = formData.showTalkToHumanButton;
  const emailEnabled = formData.handoverEmailEnabled;
  const handover = themeData.handover;

  return (
    <FormSection
      title="Human Handover"
      description="Let a teammate take over a live chat from the AI."
      info={
        <>
          <p>
            When a visitor needs a person, a teammate can take the conversation over
            from the AI.
          </p>
          <p>
            The AI <strong>pauses</strong> while a human is replying, then resumes once
            the chat is resolved.
          </p>
        </>
      }
    >
      <ToggleRow
        id="humanTakeoverEnabled"
        label="Enable human takeover"
        info={
          <p>
            Flags chats that need a human in your Inbox, and lets teammates take them
            over. This is the master switch for the whole feature.
          </p>
        }
        checked={enabled}
        onChange={(v) => updateFormData('humanTakeoverEnabled', v)}
      />

      {enabled && (
        <>
          {/* Connected notice */}
          <div className="space-y-4 border-t pt-6">
            <div className="space-y-2">
              <FieldLabel
                htmlFor="humanConnectedLabel"
                label="Connected message"
                info={
                  <p>
                    Shown to the visitor on the divider line when a teammate joins.
                    Leave blank for a sensible default.
                  </p>
                }
              />
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
              <FieldLabel
                htmlFor="handoverRequestedLabel"
                label="Connecting message"
                info={
                  <p>
                    Shown to the visitor while a teammate is being connected, before
                    anyone has actually taken over.
                  </p>
                }
              />
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
              <FieldLabel
                htmlFor="handoverEndedLabel"
                label="Handed-back message"
                info={
                  <p>
                    Shown to the visitor when the teammate resolves the chat and the AI
                    takes back over.
                  </p>
                }
              />
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
              info={
                <p>
                  Adds a headset button next to send, so visitors can ask for a person
                  directly instead of waiting for the bot to offer.
                </p>
              }
              checked={showButton}
              onChange={(v) => updateFormData('showTalkToHumanButton', v)}
            />

            {showButton && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <FieldLabel
                    htmlFor="handoverButtonLabel"
                    label="Button tooltip"
                    info={
                      <p>
                        The button is a headset icon next to send; this text shows when
                        the visitor hovers it.
                      </p>
                    }
                  />
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
              description="Sent immediately."
              info={
                <p>
                  The in-app alert, sound and browser popup <strong>always</strong>
                  fire when a visitor asks for a human. This toggle only controls the
                  email on top of that.
                </p>
              }
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
      <FieldLabel
        htmlFor="handoverEmailRecipients"
        label="Send to"
        description="Leave empty to email everyone in your organization."
        info={
          <>
            <p>
              Empty means every member of your organization gets it at their login
              email.
            </p>
            <p>
              Adding addresses sends to <strong>those only, instead</strong>. Useful
              for a shared support inbox, or people without a dashboard login. Add your
              own address too if you still want it.
            </p>
          </>
        }
      />

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
