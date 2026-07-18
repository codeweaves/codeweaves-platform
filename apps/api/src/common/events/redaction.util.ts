/**
 * Redaction, header sanitization and size-capping for event_logs writes.
 *
 * Everything an EventLog stores flows through here at write time so that:
 *   - secrets / auth headers / api keys are NEVER persisted,
 *   - oversized payloads are truncated (bounded storage at 10K-org scale),
 *   - binary blobs (audio, files) are reduced to metadata, never bytes.
 *
 * See docs/plans/observability-everywhere-plan.md §5.
 */

// NaN-guarded: a non-numeric env value (e.g. "32kb") must NOT silently disable the
// cap (Number("32kb") = NaN, and `len > NaN` is always false → unbounded rows).
const MAX_BYTES = (() => {
  const n = Number(process.env.EVENT_LOG_MAX_PAYLOAD_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 32_768;
})();

// Header names we NEVER persist (lowercased). Auth + signature headers.
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
  'xi-api-key',
  'apikey',
  'api-subscription-key',
  'x-goog-api-key',
  'x-hub-signature',
  'x-hub-signature-256',
  'svix-signature',
  'x-internal-secret',
]);

// Noisy transport headers with no debugging value — dropped to keep rows lean.
const NOISE_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'accept',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'pragma',
  'sec-fetch-mode',
  'sec-fetch-site',
  'sec-fetch-dest',
  'sec-fetch-user',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'upgrade-insecure-requests',
]);

// Body/object keys whose VALUES get replaced with [REDACTED] wherever they appear.
// Substring-matched fragments that never collide with our own telemetry keys.
const SENSITIVE_SUBSTR =
  /password|passphrase|secret|apikey|api[_-]?key|authorization|credential|cookie|ssn|card|private[_-]?key|client[_-]?secret/i;

// Token-count / timing metric keys that legitimately contain "token" — these are
// exactly what the event log exists to capture, so they must NOT be redacted.
// Anything else containing "token" (accessToken, refreshToken, apiToken, …) IS.
const TOKEN_METRIC_KEYS = new Set([
  'tokens',
  'inputtokens',
  'outputtokens',
  'totaltokens',
  'cachedinputtokens',
  'reasoningtokens',
  'prompttokens',
  'completiontokens',
  'maxtokens',
  'maxinputtokens',
  'maxoutputtokens',
  'timetofirsttoken',
  'timetolasttoken',
]);

/** True when an object key's VALUE must be replaced with [REDACTED]. */
export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  if (SENSITIVE_SUBSTR.test(k)) return true;
  if (k.includes('token')) return !TOKEN_METRIC_KEYS.has(k);
  return false;
}

/**
 * Keep only useful, non-sensitive headers. Accepts an Express headers object, a
 * fetch `Headers` instance, or a plain record. Returns `undefined` when nothing
 * survives (so the caller can omit the column rather than store `{}`).
 */
export function sanitizeHeaders(
  headers?: Record<string, unknown> | Headers | null,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const entries: [string, unknown][] =
    typeof Headers !== 'undefined' && headers instanceof Headers
      ? [...headers.entries()]
      : Object.entries(headers as Record<string, unknown>);
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    const key = k.toLowerCase();
    if (SENSITIVE_HEADERS.has(key) || NOISE_HEADERS.has(key)) continue;
    if (v == null) continue;
    out[key] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Deep-redact sensitive keys and reduce binary blobs to metadata. Returns a new
 * structure — never mutates the input. Depth/breadth capped to bound cost.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { _binary: true, bytes: (value as Uint8Array).byteLength };
  }
  if (typeof value === 'string') {
    return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  }
  if (typeof value !== 'object') return value;
  if (depth > 6) return '[depth-capped]';
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redact(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

/**
 * Redact + enforce the byte cap. Returns a Prisma-safe JSON value, or `undefined`
 * for null/undefined input (so the caller omits the column — passing raw `null`
 * to a Prisma Json field is an error, it needs Prisma.DbNull).
 */
export function capJson(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  const red = redact(value);
  let json: string;
  try {
    json = JSON.stringify(red);
  } catch {
    return { _unserializable: true };
  }
  if (json.length > MAX_BYTES) {
    return { _truncated: true, _bytes: json.length, preview: json.slice(0, 1000) };
  }
  return red;
}

/**
 * Compact, redacted, length-capped one-line string for AppLogger `meta`. Console
 * only — never throws.
 */
export function safeMeta(meta: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(redact(meta));
    return s.length > 500 ? `${s.slice(0, 500)}…` : s;
  } catch {
    return '[meta-unserializable]';
  }
}
