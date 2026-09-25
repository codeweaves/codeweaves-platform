"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useAgentEditor } from "../agent-editor-context";
import { ColorPicker } from "../color-picker";
import { FieldLabel } from "../field-label";
import { FormSection } from "../form-section";
import { ToggleRow } from "../toggle-row";

/** Mirrors the limits in `consentConfigSchema` (packages/validation). */
const NOTICE_MAX = 500;
/**
 * The same rule the server applies (packages/validation httpsUrlString): a URL
 * the browser can parse, with the https scheme. A looser or stricter local
 * rule makes the toggle disagree with what actually gets saved.
 */
function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Chat-start privacy notice (ADR-0004).
 *
 * The business that embeds the widget owns the wording, the link and the
 * choice of mode. We give them the fields; we never judge whether the wording
 * is legally enough.
 */
export function ConsentSettings() {
  const { themeData, updateThemeData } = useAgentEditor();
  const consent = themeData.consent;
  const url = consent.privacyPolicyUrl.trim();
  const urlValid = isHttpsUrl(url);
  const urlError = url !== "" && !urlValid;

  return (
    <FormSection
      title="Privacy Notice"
      description="Show your privacy notice and policy link before a visitor chats."
      info={
        <>
          <p>
            Your business decides what data the chat collects and why, so the
            wording, the link and the mode are yours. Ask your legal advisor for
            the right wording.
          </p>
          <p>
            In consent mode we keep a record of each visitor&apos;s decision,
            with a copy of the exact notice they saw.
          </p>
          <p>
            Applies to the website widget and its voice input. WhatsApp is not
            covered yet.
          </p>
        </>
      }
    >
      {/* The link comes first: the notice cannot go live without it. */}
      <div className="space-y-2">
        <FieldLabel
          htmlFor="consentPolicyUrl"
          label="Privacy policy link"
          info={
            <p>
              The public page of your own privacy policy. It must start with
              https://. When you change your policy, publish it at a new link or
              keep the old versions available.
            </p>
          }
        />
        <Input
          id="consentPolicyUrl"
          type="url"
          value={consent.privacyPolicyUrl}
          onChange={(e) => {
            const next = e.target.value.trim();
            updateThemeData("consent.privacyPolicyUrl", next);
            // No link, no notice: the server refuses to save one without it.
            if (next === "" && consent.enabled) {
              updateThemeData("consent.enabled", false);
            }
          }}
          placeholder="https://www.example.com/privacy"
          maxLength={2048}
          aria-invalid={urlError}
          aria-describedby={urlError ? "consentPolicyUrlError" : undefined}
        />
        {urlError && (
          <p id="consentPolicyUrlError" className="text-sm text-destructive">
            Enter a full link that starts with https://
          </p>
        )}
      </div>

      <ToggleRow
        id="consentEnabled"
        label="Show the privacy notice"
        description={
          urlValid ? undefined : "Add your privacy policy link to turn this on."
        }
        // Shows the real stored value. Turning it ON needs a valid link;
        // turning it OFF is always allowed.
        checked={consent.enabled}
        disabled={!consent.enabled && !urlValid}
        onChange={(v) => updateThemeData("consent.enabled", v)}
      />

      {consent.enabled && (
        <>
          <div className="space-y-3 border-t pt-6">
            <FieldLabel
              htmlFor="consentMode"
              label="Mode"
              info={
                <>
                  <p>
                    <strong>Ask for consent:</strong> the message box stays
                    locked until the visitor clicks the button. Each decision is
                    recorded.
                  </p>
                  <p>
                    <strong>Show a notice only:</strong> the visitor can type at
                    once. The notice and link show above the message box.
                  </p>
                  <p>Your legal advisor can tell you which one fits.</p>
                </>
              }
            />
            <RadioGroup
              id="consentMode"
              value={consent.mode}
              onValueChange={(v) =>
                updateThemeData("consent.mode", v as "notice" | "consent")
              }
              className="space-y-2"
            >
              <div className="flex items-center gap-3">
                <RadioGroupItem value="consent" id="consentModeConsent" />
                <Label
                  htmlFor="consentModeConsent"
                  className="cursor-pointer font-normal"
                >
                  Ask for consent
                </Label>
              </div>
              <div className="flex items-center gap-3">
                <RadioGroupItem value="notice" id="consentModeNotice" />
                <Label
                  htmlFor="consentModeNotice"
                  className="cursor-pointer font-normal"
                >
                  Show a notice only
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2 border-t pt-6">
            <FieldLabel
              htmlFor="consentNoticeText"
              label="Notice text"
              info={
                <p>
                  Say what data the chat collects and why. Replace the default
                  with wording from your legal advisor. Visitors who accepted an
                  older wording are asked again when you change it.
                </p>
              }
            />
            <Textarea
              id="consentNoticeText"
              value={consent.noticeText}
              onChange={(e) =>
                updateThemeData("consent.noticeText", e.target.value)
              }
              maxLength={NOTICE_MAX}
              rows={4}
            />
            <p className="text-right text-xs text-muted-foreground">
              {consent.noticeText.length}/{NOTICE_MAX}
            </p>
          </div>

          <div className="grid gap-4 border-t pt-6 sm:grid-cols-2">
            <div className="space-y-2">
              <FieldLabel htmlFor="consentLinkText" label="Link text" />
              <Input
                id="consentLinkText"
                value={consent.linkText}
                onChange={(e) =>
                  updateThemeData("consent.linkText", e.target.value)
                }
                placeholder="Privacy Policy"
                maxLength={40}
              />
            </div>
            {consent.mode === "consent" && (
              <>
                <div className="space-y-2">
                  <FieldLabel
                    htmlFor="consentButtonLabel"
                    label="Button text"
                  />
                  <Input
                    id="consentButtonLabel"
                    value={consent.buttonLabel}
                    onChange={(e) =>
                      updateThemeData("consent.buttonLabel", e.target.value)
                    }
                    placeholder="Start chat"
                    maxLength={30}
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabel
                    htmlFor="consentWithdrawLabel"
                    label="Withdraw link text"
                    info={
                      <p>
                        Shown in the ⋯ menu in the chat header after the visitor
                        consents. One click, as easy as agreeing.
                      </p>
                    }
                  />
                  <Input
                    id="consentWithdrawLabel"
                    value={consent.withdrawLabel}
                    onChange={(e) =>
                      updateThemeData("consent.withdrawLabel", e.target.value)
                    }
                    placeholder="Opt out"
                    maxLength={40}
                  />
                </div>
              </>
            )}
          </div>

          <div className="space-y-4 border-t pt-6">
            <ColorPicker
              id="consentTextColor"
              label="Text color"
              value={consent.textColor}
              contrastAgainst={themeData.input.backgroundColor}
              onChange={(color) => updateThemeData("consent.textColor", color)}
            />
            <ColorPicker
              id="consentLinkColor"
              label="Link color"
              value={consent.linkColor}
              contrastAgainst={themeData.input.backgroundColor}
              onChange={(color) => updateThemeData("consent.linkColor", color)}
            />
          </div>
        </>
      )}
    </FormSection>
  );
}
