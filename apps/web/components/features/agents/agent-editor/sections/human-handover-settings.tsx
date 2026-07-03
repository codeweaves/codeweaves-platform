'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAgentEditor } from '../agent-editor-context';
import { FormSection } from '../form-section';
import { ColorPicker } from '../color-picker';

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
        </>
      )}
    </FormSection>
  );
}
