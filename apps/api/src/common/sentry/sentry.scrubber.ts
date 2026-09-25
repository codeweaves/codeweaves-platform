import type { ErrorEvent, EventHint } from "@sentry/nestjs";

import { SENSITIVE_HEADERS, isSensitiveKey } from "../events/redaction.util";
import { maskPiiText } from "../../modules/pii/mask-pii";

/**
 * Recursively redact values whose keys are sensitive.
 * Handles nested objects and arrays. Shares the exact key policy
 * (`isSensitiveKey`) used for event_logs so the two paths never diverge.
 */
function scrubValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  // Request bodies, extra and contexts are KEPT for debugging; only PII inside
  // their strings is masked (ADR-0005), with the same rules as event_logs.
  if (typeof value === "string") return maskPiiText(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (typeof value === "object") {
    return scrubObject(value as Record<string, unknown>);
  }
  return value;
}

function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = scrubValue(value);
    }
  }
  return result;
}

/**
 * Scrub sensitive key=value pairs from a query string.
 * e.g. "foo=bar&token=secret&x=1" → "foo=bar&token=[REDACTED]&x=1"
 */
function scrubQueryString(qs: string): string {
  return qs
    .split("&")
    .map((pair) => {
      const eqIdx = pair.indexOf("=");
      if (eqIdx === -1) return pair;
      const key = pair.slice(0, eqIdx);
      if (isSensitiveKey(key)) {
        return `${key}=[REDACTED]`;
      }
      return pair;
    })
    .join("&");
}

/**
 * Redact sensitive request headers in place. `@sentry/core` v10 attaches ALL
 * request headers by default (not gated by sendDefaultPii), so an allowlist-by-
 * denylist here is the last line of defense. Uses the shared SENSITIVE_HEADERS
 * denylist (authorization, cookie, x-internal-secret, svix-signature, …) with a
 * case-insensitive match, since header casing is not guaranteed.
 */
function scrubHeaders(headers: Record<string, unknown>): void {
  for (const key of Object.keys(headers)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      headers[key] = "[REDACTED]";
    }
  }
}

/**
 * Redact `event.request.cookies`, which Sentry populates as a field SEPARATE
 * from `request.headers` — so the header denylist never sees it. Cookies carry
 * session material wholesale, and `@sentry/*` collects them by default, so every
 * value is redacted while the cookie NAMES are kept (useful for debugging, and
 * not secret). Handles both the parsed dictionary and a raw `a=1; b=2` string.
 */
function scrubCookies(cookies: unknown): unknown {
  if (typeof cookies === "string") {
    return cookies
      .split(";")
      .map((pair) => {
        const eqIdx = pair.indexOf("=");
        if (eqIdx === -1) return pair.trim();
        return `${pair.slice(0, eqIdx).trim()}=[REDACTED]`;
      })
      .join("; ");
  }
  if (cookies && typeof cookies === "object") {
    if (Array.isArray(cookies)) return cookies.map(() => "[REDACTED]");
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(cookies as Record<string, unknown>)) {
      out[key] = "[REDACTED]";
    }
    return out;
  }
  return cookies;
}

/**
 * Sentry beforeSend callback that strips sensitive data from events.
 */
export function scrubSentryEvent(
  event: ErrorEvent,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _hint: EventHint,
): ErrorEvent | null {
  // Scrub request headers (denylist, case-insensitive)
  if (event.request?.headers) {
    scrubHeaders(event.request.headers as Record<string, unknown>);
  }

  // Scrub cookies (a distinct field from headers — collected by default)
  const request = event.request;
  if (request && request.cookies !== undefined && request.cookies !== null) {
    request.cookies = scrubCookies(request.cookies) as typeof request.cookies;
  }

  // Scrub request query string
  if (
    event.request?.query_string &&
    typeof event.request.query_string === "string"
  ) {
    event.request.query_string = scrubQueryString(event.request.query_string);
  }

  // Request bodies never leave our servers (ADR-0005). Sentry needs the error,
  // the stack and the route to tell us what broke; the full body is in our own
  // event_logs (PII masked), found by the correlationId tag on this event.
  if (event.request?.data !== undefined && event.request?.data !== null) {
    event.request.data = "[omitted: see event_logs by correlationId]";
  }

  // Scrub extra context
  if (event.extra) {
    event.extra = scrubObject(event.extra as Record<string, unknown>);
  }

  // Exception messages and breadcrumbs can quote user input (a validation
  // error echoing a field, a log line). Masked the same way.
  if (event.message) event.message = maskPiiText(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = maskPiiText(ex.value);
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = maskPiiText(crumb.message);
    if (crumb.data)
      crumb.data = scrubObject(crumb.data as Record<string, unknown>);
  }

  // Scrub structured contexts (Sentry stores arbitrary metadata blocks here)
  if (event.contexts) {
    event.contexts = scrubObject(
      event.contexts as Record<string, unknown>,
    ) as ErrorEvent["contexts"];
  }

  return event;
}
