import { sanitizePageUrl } from "@repo/validation/page-url";

/** Only allow https URLs — blocks javascript:, data:, http:// etc. */
export function isSafeUrl(url: string): boolean {
  return /^https:\/\//i.test(url);
}

/**
 * The agent's "Record the page" switch (ADR-0020), from the widget config.
 * Off until the config says otherwise, so nothing is sent before it loads.
 */
let pageUrlCaptureEnabled = false;

export function setPageUrlCapture(enabled: boolean): void {
  pageUrlCaptureEnabled = enabled;
}

/**
 * The page the visitor is on, sent with each message so the dashboard can show
 * where a lead came from (ADR-0020). `undefined` while the agent's switch is
 * off, so the page never leaves the browser then.
 *
 * The widget runs in the host page (Shadow DOM, not an iframe), so
 * `window.location` is the customer's page. Cleaned by the same
 * `sanitizePageUrl` the API runs before storing.
 */
export function currentPageUrl(): string | undefined {
  if (!pageUrlCaptureEnabled) return undefined;
  return sanitizePageUrl(window.location.href) ?? undefined;
}
