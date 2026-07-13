import { Injectable } from '@nestjs/common';

import { detectPii, type PiiMatch } from './pii-patterns';

/**
 * PiiDetectionService: stateless facade over the deterministic recognizers.
 *
 * Two jobs:
 *   - `detect()` — full entity list (used by the tokenizer for TOKENIZE-tier).
 *   - `maskHardDrop()` — the compliance floor. Destroys HARD_DROP-tier values
 *     (Aadhaar/PAN/card/passport/DL/voter-ID) irreversibly. Runs at message
 *     ingestion on EVERY channel regardless of the per-agent PII toggle —
 *     these identifiers must never exist in Postgres, logs, or LLM context
 *     (see docs/plans/pii-redaction-plan.md, tier table).
 *
 * Pure CPU, no I/O — safe on the hot path (<1ms for chat-sized strings).
 */
@Injectable()
export class PiiDetectionService {
  detect(text: string): PiiMatch[] {
    return detectPii(text);
  }

  /**
   * Irreversibly mask HARD_DROP-tier identifiers. Returns the original string
   * unchanged (same reference) when nothing matched, so callers can cheaply
   * detect "something was dropped" via identity comparison if needed.
   */
  maskHardDrop(text: string): string {
    if (!text) return text;
    const matches = detectPii(text).filter((m) => m.tier === 'HARD_DROP');
    if (matches.length === 0) return text;
    let out = '';
    let cursor = 0;
    for (const m of matches) {
      out += text.slice(cursor, m.start) + (m.hardDropMask ?? `[${m.category} REDACTED]`);
      cursor = m.end;
    }
    out += text.slice(cursor);
    return out;
  }
}
