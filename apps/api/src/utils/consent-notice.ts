import { createHash } from "node:crypto";
import { consentConfigSchema, type ConsentConfig } from "@repo/validation";

/**
 * Read the consent section of a stored widget theme (`agent_themes.config`).
 *
 * Themes saved before the section existed have no `consent` key; the schema's
 * field defaults turn that into a disabled config. Stored themes are validated
 * on every write, so a parse failure means a hand-edited row, and we fall back
 * to the defaults rather than throw on the chat hot path.
 */
export function readConsentConfig(themeConfig: unknown): ConsentConfig {
  const raw =
    themeConfig && typeof themeConfig === "object"
      ? (themeConfig as Record<string, unknown>).consent
      : undefined;
  const parsed = consentConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : consentConfigSchema.parse({});
}

/**
 * The notice is live only when it is on AND has the client's policy link. The
 * widget applies the same rule, so a notice the visitor never saw is never
 * enforced.
 */
export function isNoticeActive(config: ConsentConfig): boolean {
  return config.enabled && config.privacyPolicyUrl !== "";
}

/** Consent mode: the server refuses new sessions without a GRANTED event. */
export function requiresConsent(config: ConsentConfig): boolean {
  return isNoticeActive(config) && config.mode === "consent";
}

/**
 * SHA-256 over exactly the fields the visitor sees. Works like a notice
 * revision number: any change to the wording, link or button asks every
 * visitor again. Colours are left out on purpose, restyling is not a new notice.
 */
export function computeNoticeHash(config: ConsentConfig): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        config.noticeText,
        config.linkText,
        config.privacyPolicyUrl,
        config.buttonLabel,
      ]),
    )
    .digest("hex");
}

/** What a widget needs to render the notice (colours come from the theme). */
export function publicNoticeView(config: ConsentConfig) {
  return {
    mode: config.mode,
    noticeText: config.noticeText,
    linkText: config.linkText,
    privacyPolicyUrl: config.privacyPolicyUrl,
    buttonLabel: config.buttonLabel,
    withdrawLabel: config.withdrawLabel,
  };
}
export type PublicNoticeView = ReturnType<typeof publicNoticeView>;

/**
 * The stored theme with its consent section replaced by the fully defaulted
 * one. A PATCH stores only the keys it sent, so a stored section can be
 * partial; the widget must render exactly the wording the server hashes and
 * snapshots as proof, never a blank where a default belongs.
 */
export function withNormalizedConsent<T>(themeConfig: T): T {
  if (!themeConfig || typeof themeConfig !== "object") return themeConfig;
  return { ...themeConfig, consent: readConsentConfig(themeConfig) };
}

/** The consent fields a stored theme's audit trail cares about. */
export function consentAuditView(config: ConsentConfig) {
  return {
    enabled: config.enabled,
    mode: config.mode,
    noticeText: config.noticeText,
    linkText: config.linkText,
    privacyPolicyUrl: config.privacyPolicyUrl,
    buttonLabel: config.buttonLabel,
    noticeHash: computeNoticeHash(config),
  };
}
