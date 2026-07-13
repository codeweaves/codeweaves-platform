import type { PiiSessionContext } from './pii-tokenizer.service';

/**
 * Streaming-safe detokenizer: re-hydrates `[CATEGORY_N]` placeholders in an
 * LLM token stream without adding latency.
 *
 * Text flushes through immediately; the ONLY thing ever held back is a
 * trailing fragment that could still grow into a placeholder (an unclosed
 * `[EMAI` at the end of a chunk). Placeholders are short, so worst-case
 * buffering is a few characters for one chunk. Bounded: a "[" run that grows
 * past MAX_TOKEN_LENGTH without closing is flushed as-is (it was never ours).
 */
const MAX_TOKEN_LENGTH = 40; // generous: longest category + _NNN + brackets

/** A (possibly empty) prefix of a placeholder at the very end of `s`. */
function partialTokenStart(s: string): number {
  const open = s.lastIndexOf('[');
  if (open === -1) return -1;
  const tail = s.slice(open);
  if (tail.includes(']')) return -1; // closed — nothing partial
  if (tail.length > MAX_TOKEN_LENGTH) return -1; // too long to be a token
  // Only hold back if the fragment still LOOKS like one of ours: "[", then
  // uppercase/underscore run, optionally digits (no other chars allowed).
  return /^\[[A-Z_]*\d*$/.test(tail) ? open : -1;
}

export class StreamDetokenizer {
  private buffer = '';

  constructor(private readonly ctx: PiiSessionContext | null) {}

  /** Process one text delta; returns what can be safely emitted now. */
  push(delta: string): string {
    if (!this.ctx?.hasTokens) return delta; // fast path: nothing to re-hydrate
    this.buffer += delta;
    const holdFrom = partialTokenStart(this.buffer);
    const emit = holdFrom === -1 ? this.buffer : this.buffer.slice(0, holdFrom);
    this.buffer = holdFrom === -1 ? '' : this.buffer.slice(holdFrom);
    return this.ctx.detokenize(emit);
  }

  /** Emit anything still held (call once, after the stream ends). */
  end(): string {
    if (!this.ctx?.hasTokens || this.buffer.length === 0) return '';
    const rest = this.ctx.detokenize(this.buffer);
    this.buffer = '';
    return rest;
  }
}
