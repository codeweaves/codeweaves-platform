/**
 * Chat-start privacy notice + consent (ADR-0004).
 *
 * The server holds the proof (an append-only `visitor_consents` row per
 * decision) and enforces it: in consent mode it refuses to open a chat for a
 * visitor without a current grant. This module only keeps the widget in step:
 *
 *   - `consentGranted` drives the "Start chat" lock in the UI.
 *   - localStorage remembers WHICH notice revision (hash) this browser
 *     accepted, so a reload (which always starts a new session) does not ask
 *     again. A changed notice has a new hash, so the visitor is asked again.
 *
 * localStorage is a convenience cache here, never the source of truth: if it
 * says "granted" but the server disagrees (withdrawn in another tab, notice
 * changed), the server answers CONSENT_REQUIRED and `revokeLocalConsent` puts
 * the lock back.
 */

import { signal } from "@preact/signals";
import { clearConfigCache } from "./config-loader";

const KEY_PREFIX = "cw_consent_";

/** True once the visitor accepted the CURRENT notice (consent mode only). */
export const consentGranted = signal(false);

/** The notice as the visitor must see it. Colours come from the theme. */
export interface ConsentNoticeView {
  mode: "notice" | "consent";
  noticeText: string;
  linkText: string;
  privacyPolicyUrl: string;
  buttonLabel: string;
  withdrawLabel: string;
}

/**
 * Set when the server refused a grant because the notice changed after this
 * page loaded its (possibly cached) config. Holds the server's current notice
 * so the visitor reads the new wording before they click again.
 */
export const consentNoticeOverride = signal<{
  notice: ConsentNoticeView;
  noticeHash: string;
} | null>(null);

/** Error code the API uses when a chat needs consent first. */
export const CONSENT_REQUIRED = "CONSENT_REQUIRED";

export function readAcceptedNotice(agentId: string): string | null {
  try {
    return localStorage.getItem(`${KEY_PREFIX}${agentId}`);
  } catch {
    return null;
  }
}

export function rememberAcceptedNotice(
  agentId: string,
  noticeHash: string,
): void {
  try {
    localStorage.setItem(`${KEY_PREFIX}${agentId}`, noticeHash);
  } catch {
    /* storage blocked: the visitor is simply asked again next visit */
  }
}

export function forgetAcceptedNotice(agentId: string): void {
  try {
    localStorage.removeItem(`${KEY_PREFIX}${agentId}`);
  } catch {
    /* nothing to forget */
  }
}

/** Sync the lock with this browser's stored decision for the live notice. */
export function syncConsentFromStorage(
  agentId: string,
  noticeHash: string | null,
): void {
  consentGranted.value =
    !!noticeHash && readAcceptedNotice(agentId) === noticeHash;
}

/** The server said consent is missing: drop the cached grant and lock again. */
export function revokeLocalConsent(agentId: string): void {
  forgetAcceptedNotice(agentId);
  consentGranted.value = false;
}

/**
 * Apply a CONSENT_REQUIRED refusal. The server sends the live notice with it,
 * so a page whose cached config still says "notice off" (the owner just turned
 * consent on) shows the notice and the button at once instead of leaving the
 * visitor with nothing to accept.
 */
export function applyConsentRequired(
  agentId: string,
  live?: { notice?: ConsentNoticeView; noticeHash?: string },
): void {
  revokeLocalConsent(agentId);
  // The cached config may be the stale "notice off" one; fetch it fresh next load.
  clearConfigCache(agentId);
  if (live?.notice && live.noticeHash) {
    consentNoticeOverride.value = {
      notice: live.notice,
      noticeHash: live.noticeHash,
    };
  }
}
