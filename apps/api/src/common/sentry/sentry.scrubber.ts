import type { ErrorEvent, EventHint } from '@sentry/nestjs';

const SENSITIVE_KEYS =
  /^(password|secret|token|apikey|api_key|credential|authorization)$/i;

const SCRUBBED_HEADERS = ['authorization'];

/**
 * Recursively redact values whose keys match sensitive patterns.
 * Handles nested objects and arrays.
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
    if (SENSITIVE_KEYS.test(key)) {
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
      if (SENSITIVE_KEYS.test(key)) {
        return `${key}=[REDACTED]`;
      }
      return pair;
    })
    .join('&');
}

/**
 * Sentry beforeSend callback that strips sensitive data from events.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function scrubSentryEvent(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  // Scrub request headers
  if (event.request?.headers) {
    for (const header of SCRUBBED_HEADERS) {
      if (header in event.request.headers) {
        event.request.headers[header] = '[REDACTED]';
      }
    }
  }

  // Scrub request query string
  if (event.request?.query_string && typeof event.request.query_string === 'string') {
    event.request.query_string = scrubQueryString(event.request.query_string);
  }

  // Scrub request data (body)
  if (
    event.request?.data &&
    typeof event.request.data === 'object' &&
    event.request.data !== null
  ) {
    event.request.data = scrubObject(
      event.request.data as Record<string, unknown>,
    );
  }

  // Scrub extra context
  if (event.extra) {
    event.extra = scrubObject(event.extra as Record<string, unknown>);
  }

  return event;
}
