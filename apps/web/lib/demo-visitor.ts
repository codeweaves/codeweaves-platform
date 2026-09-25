/**
 * Visitor identity + consent memory for the public demo page (ADR-0004).
 *
 * The demo page is public, so its visitors are real people and go through the
 * same server consent gate as the widget. The server keys consent on the
 * X-Device-Id header, so the page needs a stable random ID of its own. It is
 * created on first use of the chat, not on page load.
 */

const DEVICE_KEY = "cw_demo_device_id";
const CONSENT_PREFIX = "cw_demo_consent_";

let cached: string | null = null;

/** Stable random device ID for this browser, created on first call. */
export function getDemoDeviceId(): string {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (stored) {
      cached = stored;
      return stored;
    }
  } catch {
    /* storage blocked: an in-memory ID for this page only */
  }
  cached = crypto.randomUUID();
  try {
    localStorage.setItem(DEVICE_KEY, cached);
  } catch {
    /* in-memory only */
  }
  return cached;
}

/** The notice revision (hash) this browser accepted for the agent, if any. */
export function readDemoConsent(agentId: string): string | null {
  try {
    return localStorage.getItem(`${CONSENT_PREFIX}${agentId}`);
  } catch {
    return null;
  }
}

export function rememberDemoConsent(agentId: string, noticeHash: string): void {
  try {
    localStorage.setItem(`${CONSENT_PREFIX}${agentId}`, noticeHash);
  } catch {
    /* asked again next visit */
  }
}

export function forgetDemoConsent(agentId: string): void {
  try {
    localStorage.removeItem(`${CONSENT_PREFIX}${agentId}`);
  } catch {
    /* nothing to forget */
  }
}
