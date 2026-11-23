/**
 * Page URL of a visitor message (ADR-0020).
 *
 * The widget reads the address of the page the visitor is on. We keep only the
 * parts that tell the business where the lead came from:
 *   - the origin and path (`https://shop.com/pricing`)
 *   - the campaign tags marketers add to ad links (`utm_source`, ...)
 *
 * Everything else is removed. Other query parameters and the `#fragment` can
 * carry emails, tokens or password-reset links, and `user:pass@` credentials
 * can appear in the authority. Only http(s) is accepted, so a stored value can
 * never be a `javascript:` or `data:` URL.
 *
 * One function for both sides: the widget cleans before it sends (so private
 * parts never leave the browser), and the API cleans again before it stores
 * (the request is untrusted). The widget imports this file through the
 * `@repo/validation/page-url` entry, so it must not import zod or anything else.
 */

/** Longest cleaned URL we store (`chat_messages.pageUrl` is VARCHAR(2048)). */
export const PAGE_URL_MAX_LENGTH = 2048;

/** The standard campaign tags. Matched case-insensitively. */
export const PAGE_URL_KEPT_PARAMS: readonly string[] = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
];

/**
 * A page URL that has been through {@link sanitizePageUrl}. Storage code takes
 * this type, not `string`, so a raw request value cannot be stored by mistake.
 */
export type CleanPageUrl = string & { readonly __brand: "CleanPageUrl" };

/**
 * Clean a raw page URL. Returns `null` when the input is not an http(s) URL or
 * the cleaned result is longer than {@link PAGE_URL_MAX_LENGTH}.
 */
export function sanitizePageUrl(raw: unknown): CleanPageUrl | null {
  if (typeof raw !== "string" || raw.length === 0) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (PAGE_URL_KEPT_PARAMS.includes(key.toLowerCase())) {
      kept.append(key, value);
    }
  }
  const query = kept.toString();
  // `origin` drops any `user:pass@`; `pathname` drops the query and fragment.
  const clean = `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
  return clean.length <= PAGE_URL_MAX_LENGTH ? (clean as CleanPageUrl) : null;
}
