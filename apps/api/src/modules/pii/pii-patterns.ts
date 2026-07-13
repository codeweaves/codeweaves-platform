/**
 * PII recognizers: deterministic pattern + checksum detection, no ML, no I/O.
 *
 * Design (see docs/plans/pii-redaction-plan.md §3):
 *   - Identifier detection is language-independent — an Aadhaar number is 12
 *     digits whether the surrounding sentence is English, Hindi, or Hinglish.
 *     Devanagari digits are normalized (1:1 char mapping, offsets preserved)
 *     before matching so "मेरा आधार ९९७१-७५८२-२४६२ है" is caught too.
 *   - Checksums (Verhoeff for Aadhaar, Luhn for cards) kill the digit-run
 *     false positives that plain regexes would mask into oblivion.
 *   - Formats with high collision risk against ordinary IDs (passport, DL,
 *     voter ID, bank account, DOB) are CONTEXT-GATED: they only match when a
 *     nearby keyword ("passport", "जन्म", "a/c", …) signals intent. Missing
 *     context ⇒ no match — under-matching is recoverable (NER phase later),
 *     over-matching breaks the product.
 *
 * Names and free-text addresses are deliberately NOT detected here — that is
 * NER territory (plan §3 phase 4) and names are ALLOW-tier by policy anyway.
 */

/** Policy tier for a detected entity. See pii-redaction-plan.md §"three-tier". */
export type PiiTier = 'ALLOW' | 'TOKENIZE' | 'HARD_DROP';

export type PiiCategory =
  | 'EMAIL'
  | 'PHONE'
  | 'AADHAAR'
  | 'PAN'
  | 'CARD'
  | 'PASSPORT'
  | 'DRIVING_LICENCE'
  | 'VOTER_ID'
  | 'IFSC'
  | 'BANK_ACCOUNT'
  | 'DOB';

export interface PiiMatch {
  category: PiiCategory;
  tier: PiiTier;
  /** Offsets into the ORIGINAL text (normalization is offset-preserving). */
  start: number;
  end: number;
  /** The matched value as it appeared in the original text. */
  value: string;
  /** Replacement for HARD_DROP masking (e.g. keeps card last-4). */
  hardDropMask?: string;
}

export const CATEGORY_TIERS: Record<PiiCategory, PiiTier> = {
  EMAIL: 'ALLOW',
  PHONE: 'ALLOW',
  AADHAAR: 'HARD_DROP',
  PAN: 'HARD_DROP',
  CARD: 'HARD_DROP',
  PASSPORT: 'HARD_DROP',
  DRIVING_LICENCE: 'HARD_DROP',
  VOTER_ID: 'HARD_DROP',
  IFSC: 'TOKENIZE',
  BANK_ACCOUNT: 'TOKENIZE',
  DOB: 'TOKENIZE',
};

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** Devanagari (०-९) → ASCII digits. 1:1 mapping, so offsets are preserved. */
export function normalizeDigits(text: string): string {
  // ० = ०. Also handle Gujarati/Bengali digit blocks used in Indian chats
  // rarely; start with Devanagari (the dominant one) — others are additive.
  return text.replace(/[०-९]/g, (d) =>
    String.fromCharCode(d.charCodeAt(0) - 0x0966 + 0x30),
  );
}

// ---------------------------------------------------------------------------
// Checksums
// ---------------------------------------------------------------------------

/** Luhn checksum (payment cards). Input: digits only. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

// Verhoeff tables (standard construction; used by UIDAI for Aadhaar).
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
] as const;
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
] as const;

/** Verhoeff checksum (Aadhaar). Input: digits only (12 for Aadhaar). */
export function verhoeffValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  const reversed = digits.split('').reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = VERHOEFF_D[c]![VERHOEFF_P[i % 8]![reversed[i]!.charCodeAt(0) - 48]!]!;
  }
  return c === 0;
}

// ---------------------------------------------------------------------------
// Context gating
// ---------------------------------------------------------------------------

/** How far around a match we look for a gating keyword (chars). */
const CONTEXT_WINDOW = 48;

function hasContext(text: string, start: number, end: number, words: RegExp): boolean {
  const from = Math.max(0, start - CONTEXT_WINDOW);
  const to = Math.min(text.length, end + CONTEXT_WINDOW);
  return words.test(text.slice(from, to));
}

const PASSPORT_CONTEXT = /passport|पासपोर्ट/i;
const DL_CONTEXT = /driving|licen[cs]e|\bdl\b|ड्राइविंग|लाइसेंस/i;
const VOTER_CONTEXT = /voter|epic|मतदाता/i;
const ACCOUNT_CONTEXT = /\bacc(?:oun)?t\b|\ba\/c\b|\bbank\b|खाता|अकाउंट/i;
const DOB_CONTEXT = /\bdob\b|\bbirth\b|\bborn\b|जन्म/i;
const AADHAAR_CONTEXT = /aadha?ar|आधार|\buid\b/i;

// ---------------------------------------------------------------------------
// Recognizers
// ---------------------------------------------------------------------------

interface Recognizer {
  category: PiiCategory;
  pattern: RegExp; // MUST be constructed with /g
  /** Extra validation on the raw match; return the mask override or null to reject. */
  validate?: (raw: string, text: string, start: number, end: number) => boolean;
  hardDropMask?: (raw: string) => string;
}

/**
 * Guard against matching a slice of a longer digit run (e.g. 16-digit card
 * matched inside a 20-digit tracking number).
 */
function digitBounded(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1]! : '';
  const after = end < text.length ? text[end]! : '';
  return !/\d/.test(before) && !/\d/.test(after);
}

const RECOGNIZERS: Recognizer[] = [
  {
    category: 'EMAIL',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    // Indian mobiles (+91/0 prefixed or bare 10-digit starting 6-9) and E.164.
    category: 'PHONE',
    pattern: /(?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}\b|\+\d{1,3}[\s-]?\d{6,12}\b/g,
    validate: (raw, text, start, end) => digitBounded(text, start, end) && raw.replace(/\D/g, '').length >= 10,
  },
  {
    // 12 digits, optional 4-4-4 grouping. Verhoeff checksum is the primary
    // gate; context keyword rescues checksum-valid numbers with odd spacing.
    category: 'AADHAAR',
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    validate: (raw, text, start, end) => {
      if (!digitBounded(text, start, end)) return false;
      const digits = raw.replace(/\D/g, '');
      if (digits.length !== 12 || digits[0] === '0' || digits[0] === '1') return false;
      return verhoeffValid(digits) || hasContext(text, start, end, AADHAAR_CONTEXT);
    },
    hardDropMask: () => '[AADHAAR REDACTED]',
  },
  {
    category: 'PAN',
    pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
    hardDropMask: () => '[PAN REDACTED]',
  },
  {
    // 13-19 digits with optional space/dash grouping, Luhn-valid.
    category: 'CARD',
    pattern: /\b(?:\d[\s-]?){12,18}\d\b/g,
    validate: (raw, text, start, end) => {
      if (!digitBounded(text, start, end)) return false;
      const digits = raw.replace(/\D/g, '');
      return digits.length >= 13 && digits.length <= 19 && luhnValid(digits);
    },
    hardDropMask: (raw) => `[CARD REDACTED ****${raw.replace(/\D/g, '').slice(-4)}]`,
  },
  {
    // Indian passport: letter + 7 digits. Collides with order-ID-like tokens,
    // so context-gated.
    category: 'PASSPORT',
    pattern: /\b[A-PR-Z][0-9]{7}\b/g,
    validate: (raw, text, start, end) => hasContext(text, start, end, PASSPORT_CONTEXT),
    hardDropMask: () => '[PASSPORT REDACTED]',
  },
  {
    // e.g. MH12 20110012345 / DL-0420110012345 (state + RTO + year + serial).
    category: 'DRIVING_LICENCE',
    pattern: /\b[A-Z]{2}[\s-]?\d{2}[\s-]?\d{4}[\s-]?\d{7}\b/g,
    validate: (raw, text, start, end) => hasContext(text, start, end, DL_CONTEXT),
    hardDropMask: () => '[DRIVING LICENCE REDACTED]',
  },
  {
    category: 'VOTER_ID',
    pattern: /\b[A-Z]{3}\d{7}\b/g,
    validate: (raw, text, start, end) => hasContext(text, start, end, VOTER_CONTEXT),
    hardDropMask: () => '[VOTER ID REDACTED]',
  },
  {
    // IFSC codes are bank-routing data — tokenized, not dropped: a human agent
    // may legitimately need it, the LLM never does.
    category: 'IFSC',
    pattern: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g,
  },
  {
    // 9-18 digit runs, only with account-ish context nearby.
    category: 'BANK_ACCOUNT',
    pattern: /\b\d{9,18}\b/g,
    validate: (raw, text, start, end) =>
      digitBounded(text, start, end) && hasContext(text, start, end, ACCOUNT_CONTEXT),
  },
  {
    // dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd — only with birth-ish context.
    category: 'DOB',
    pattern: /\b(?:\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g,
    validate: (raw, text, start, end) => hasContext(text, start, end, DOB_CONTEXT),
  },
];

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect PII entities in `text`. Returns non-overlapping matches sorted by
 * start offset; when two recognizers overlap, the earlier-starting (then
 * longer) match wins — e.g. an Aadhaar inside a longer card-like run.
 */
export function detectPii(text: string): PiiMatch[] {
  if (!text) return [];
  const normalized = normalizeDigits(text);
  const matches: PiiMatch[] = [];

  for (const rec of RECOGNIZERS) {
    rec.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rec.pattern.exec(normalized)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (rec.validate && !rec.validate(m[0], normalized, start, end)) continue;
      matches.push({
        category: rec.category,
        tier: CATEGORY_TIERS[rec.category],
        start,
        end,
        value: text.slice(start, end),
        ...(rec.hardDropMask ? { hardDropMask: rec.hardDropMask(m[0]) } : {}),
      });
    }
  }

  // Resolve overlaps: sort by start asc, length desc; keep first non-overlapping.
  matches.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: PiiMatch[] = [];
  let lastEnd = -1;
  for (const match of matches) {
    if (match.start >= lastEnd) {
      kept.push(match);
      lastEnd = match.end;
    }
  }
  return kept;
}
