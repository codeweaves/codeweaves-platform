import type { ErrorEvent, EventHint } from '@sentry/nestjs';

import {
  SENSITIVE_HEADERS,
  isSensitiveKey,
} from '../events/redaction.util';

/**
 * Recursively redact values whose keys are sensitive.
 * Handles nested objects and arrays. Shares the exact key policy
 * (`isSensitiveKey`) used for event_logs so the two paths never diverge.
 */
function scrubValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(scrubValue);
  if (typeof value === 'object') {
    return scrubObject(value as Record<string, unknown>);
  }
  return value;
}

function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      result[key] = '[REDACTED]';
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
    .split('&')
    .map((pair) => {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) return pair;
      const key = pair.slice(0, eqIdx);
      if (isSensitiveKey(key)) {
        return `${key}=[REDACTED]`;
      }
      return pair;
    })
    .join('&');
}

/**
 * Scrub a request body that Sentry may capture as EITHER a parsed object OR a
 * raw string (its default for many content types). A string body is JSON-parsed
 * so its keys can be scrubbed individually; if it isn't parseable JSON we cannot
 * inspect it safely, so the whole thing is dropped rather than risk shipping a
 * secret-bearing payload verbatim.
 */
function scrubRequestData(data: unknown): unknown {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data);
      if (parsed && typeof parsed === 'object') {
        return JSON.stringify(scrubValue(parsed));
      }
    } catch {
      // Not JSON — can't scrub per-key, so omit it entirely.
    }
    return '[REDACTED]';
  }

  if (typeof data === 'object') {
    return scrubValue(data);
  }

  return data;
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
      headers[key] = '[REDACTED]';
    }
  }
}

/**
 * Sentry beforeSend callback that strips sensitive data from events.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function scrubSentryEvent(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  // Scrub request headers (denylist, case-insensitive)
  if (event.request?.headers) {
    scrubHeaders(event.request.headers as Record<string, unknown>);
  }

  // Scrub request query string
  if (event.request?.query_string && typeof event.request.query_string === 'string') {
    event.request.query_string = scrubQueryString(event.request.query_string);
  }

  // Scrub request data (body) — object OR raw string
  if (event.request?.data !== undefined && event.request?.data !== null) {
    event.request.data = scrubRequestData(event.request.data);
  }

  // Scrub extra context
  if (event.extra) {
    event.extra = scrubObject(event.extra as Record<string, unknown>);
  }

  // Scrub structured contexts (Sentry stores arbitrary metadata blocks here)
  if (event.contexts) {
    event.contexts = scrubObject(
      event.contexts as Record<string, unknown>,
    ) as ErrorEvent['contexts'];
  }

  return event;
}
