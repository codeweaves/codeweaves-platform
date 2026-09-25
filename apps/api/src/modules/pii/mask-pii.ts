import { detectPii, spliceMatches, type PiiMatch } from "./pii-patterns";

/**
 * Mask PII for anything we keep for debugging: event_logs bodies, AI traces,
 * the ai-trace file log, console error output and Sentry reports.
 *
 * The rule (ADR-0005): log everything, but never a real identifier. It uses
 * the same recognizers as the transcript pipeline, so a value masked in the
 * conversation is masked in its log copies too:
 *   - HARD_DROP tier (card, Aadhaar, passport, ...) → its drop mask, e.g.
 *     `[CARD REDACTED ****1111]`
 *   - TOKENIZE tier (PAN, bank account, DOB, IFSC, ...) → `[CATEGORY REDACTED]`.
 *     Logs never get a vault token, because a log line must never be the path
 *     back to a real value.
 *   - ALLOW tier (email, phone) is left readable, as in the transcript.
 *
 * Names and addresses are not detected (neither are they in the transcript).
 * Pure CPU, no I/O. Never throws: a masking failure must not break the caller.
 */
export function maskPiiText(text: string): string {
  if (!text) return text;
  let matches: PiiMatch[];
  try {
    matches = detectPii(text).filter((m) => m.tier !== "ALLOW");
  } catch {
    return text;
  }
  return spliceMatches(text, matches, (m) =>
    m.tier === "HARD_DROP"
      ? (m.hardDropMask ?? `[${m.category} REDACTED]`)
      : `[${m.category} REDACTED]`,
  );
}

export interface MaskLimits {
  /**
   * Strings longer than this are cut (plus a margin) BEFORE masking, so no
   * work is spent on text the log writer will throw away. The margin is
   * longer than any identifier, so a value straddling the writer's own cut is
   * still masked whole before it is cut.
   */
  maxStringLength?: number;
  /** Arrays are cut to this many items before masking. */
  maxArrayLength?: number;
  /** Nesting below this depth is returned unmasked (the writer caps it anyway). */
  maxDepth?: number;
}

const CUT_MARGIN = 64;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const DEFAULT_MAX_DEPTH = 20;

/**
 * Field names that hold identifiers, not content: `id`, `agentId`,
 * `phone_number_id`, `messageIds`. A long numeric id can pass the card (Luhn)
 * or Aadhaar (Verhoeff) checksum by chance; masking it would blind us to the
 * exact value we need when debugging (e.g. a WhatsApp phone_number_id).
 */
const ID_FIELD = /(^id|Id|_id|Ids|_ids)$/;

function isBinary(value: unknown): boolean {
  return (
    (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) ||
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer
  );
}

/**
 * Copy of `value` with every string masked by {@link maskPiiText}. Keys are
 * kept, values of id fields are kept, binary data and non-string primitives
 * pass through untouched. Never mutates its input.
 */
export function maskPiiDeep<T>(
  value: T,
  limits: MaskLimits = {},
  depth = 0,
): T {
  if (typeof value === "string") {
    const max = limits.maxStringLength;
    const text =
      max !== undefined && value.length > max + CUT_MARGIN
        ? value.slice(0, max + CUT_MARGIN)
        : value;
    return maskPiiText(text) as T;
  }
  if (value === null || typeof value !== "object") return value;
  if (isBinary(value) || value instanceof Date) return value;
  if (depth >= (limits.maxDepth ?? DEFAULT_MAX_DEPTH)) return value;
  if (Array.isArray(value)) {
    const items =
      limits.maxArrayLength !== undefined
        ? value.slice(0, limits.maxArrayLength)
        : value;
    return items.map((v: unknown) => maskPiiDeep(v, limits, depth + 1)) as T;
  }
  // Object.fromEntries defines plain own properties, so a remote key such as
  // "__proto__" can never reach the prototype. Those keys are attack
  // payloads, never log data, and are dropped as redact() does.
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !UNSAFE_KEYS.has(key))
      .map(([key, v]) => [
        key,
        ID_FIELD.test(key) ? v : maskPiiDeep(v, limits, depth + 1),
      ]),
  ) as T;
}
