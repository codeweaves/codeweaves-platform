/**
 * SentenceBuffer accumulates streaming tokens and emits complete sentences
 * for progressive TTS synthesis. Detects sentence boundaries while handling
 * abbreviations, numbered lists, ellipsis, and URLs.
 */
export class SentenceBuffer {
  private buffer = '';

  private readonly MIN_SENTENCE_LENGTH = 10;
  private readonly MAX_BUFFER_LENGTH = 500;
  private readonly MAX_FORCE_FLUSH_ITERATIONS = 20;

  private static readonly WHITESPACE_CHARS = new Set([
    ' ',
    '\n',
    '\t',
    '\r',
  ]);

  // Common abbreviations that end with a period but are NOT sentence boundaries
  private static readonly ABBREVIATIONS = new Set([
    'mr',
    'mrs',
    'ms',
    'dr',
    'prof',
    'sr',
    'jr',
    'vs',
    'etc',
    'approx',
    'dept',
    'vol',
    'gen',
    'gov',
    'sgt',
    'cpl',
    'pvt',
    'capt',
    'lt',
    'col',
    'maj',
  ]);

  // Multi-dot abbreviations — matched as whole tokens
  private static readonly MULTI_DOT_ABBREVIATIONS = [
    'e.g.',
    'i.e.',
    'u.s.',
    'u.k.',
    'a.m.',
    'p.m.',
  ];

  addToken(token: string): string[] {
    this.buffer += token;
    return this.extractSentences();
  }

  flush(): string | null {
    const remaining = this.buffer.trim();
    this.buffer = '';
    return remaining.length > 0 ? remaining : null;
  }

  private static isWhitespace(char: string | undefined): boolean {
    return char !== undefined && SentenceBuffer.WHITESPACE_CHARS.has(char);
  }

  private extractSentences(): string[] {
    const sentences: string[] = [];
    let forceFlushIterations = 0;

    while (true) {
      // Force-flush if buffer exceeds max length
      if (this.buffer.length >= this.MAX_BUFFER_LENGTH) {
        // Guard against infinite loops (e.g., whitespace-only buffers)
        forceFlushIterations++;
        if (forceFlushIterations > this.MAX_FORCE_FLUSH_ITERATIONS) {
          // Discard remaining whitespace-only content to break the loop
          this.buffer = this.buffer.trim();
          break;
        }

        // Try to break at last space for cleaner output, respecting surrogate pairs
        const breakPoint = this.findSafeBreakPoint();
        const chunk = this.buffer.slice(0, breakPoint).trim();
        this.buffer = this.buffer.slice(breakPoint);

        // If chunk is empty (whitespace-only), trim buffer and re-check
        if (chunk.length === 0) {
          this.buffer = this.buffer.trimStart();
          continue;
        }

        sentences.push(chunk);
        continue;
      }

      // Find the first boundary that produces a sentence >= MIN_SENTENCE_LENGTH.
      // If a boundary produces a short sentence, skip it and look for the next one
      // so the short fragment merges with the following text.
      let searchFrom = 0;
      let foundBoundary = -1;

      while (true) {
        const boundaryIndex = this.findSentenceBoundary(searchFrom);
        if (boundaryIndex === -1) {
          break;
        }

        const candidate = this.buffer.slice(0, boundaryIndex + 1).trim();
        if (candidate.length >= this.MIN_SENTENCE_LENGTH) {
          foundBoundary = boundaryIndex;
          break;
        }

        // Short sentence — skip this boundary and look for next
        searchFrom = boundaryIndex + 1;
      }

      if (foundBoundary === -1) {
        break;
      }

      const sentence = this.buffer.slice(0, foundBoundary + 1).trim();
      this.buffer = this.buffer.slice(foundBoundary + 1);
      sentences.push(sentence);
    }

    return sentences;
  }

  /**
   * Find a safe break point for force-flushing that doesn't split surrogate pairs.
   * Prefers breaking at a space in the second half; falls back to MAX_BUFFER_LENGTH
   * adjusted to avoid splitting a surrogate pair.
   */
  private findSafeBreakPoint(): number {
    const lastSpace = this.buffer.lastIndexOf(' ', this.MAX_BUFFER_LENGTH);
    let breakPoint =
      lastSpace > this.MAX_BUFFER_LENGTH / 2
        ? lastSpace
        : this.MAX_BUFFER_LENGTH;

    // Avoid splitting a UTF-16 surrogate pair
    if (breakPoint < this.buffer.length) {
      const charCode = this.buffer.charCodeAt(breakPoint);
      // If we're at a low surrogate (second half of a pair), step back one
      if (charCode >= 0xdc00 && charCode <= 0xdfff && breakPoint > 0) {
        breakPoint--;
      }
    }

    return breakPoint;
  }

  private findSentenceBoundary(startFrom = 0): number {
    const buf = this.buffer;

    for (let i = startFrom; i < buf.length; i++) {
      const char = buf[i];

      if (char !== '.' && char !== '!' && char !== '?') {
        continue;
      }

      // Must be followed by whitespace (NOT end-of-buffer — more tokens may arrive;
      // flush() handles the end-of-stream case)
      if (!SentenceBuffer.isWhitespace(buf[i + 1])) {
        continue;
      }

      // Skip ellipsis ("..." or "…")
      if (char === '.' && this.isEllipsis(buf, i)) {
        continue;
      }

      // Skip URLs
      if (char === '.' && this.isInsideUrl(buf, i)) {
        continue;
      }

      // Skip numbered lists: "1. ", "2. ", etc. (only at line/sentence start)
      if (char === '.' && this.isNumberedList(buf, i)) {
        continue;
      }

      // Skip abbreviations: "Dr. ", "Mr. ", etc.
      if (char === '.' && this.isAbbreviation(buf, i)) {
        continue;
      }

      return i;
    }

    return -1;
  }

  private isEllipsis(buf: string, index: number): boolean {
    // Check for "..." pattern — look behind and ahead for consecutive dots
    if (index >= 2 && buf[index - 1] === '.' && buf[index - 2] === '.') {
      return true;
    }
    if (
      index >= 1 &&
      buf[index - 1] === '.' &&
      index + 1 < buf.length &&
      buf[index + 1] === '.'
    ) {
      return true;
    }
    if (
      index + 2 < buf.length &&
      buf[index + 1] === '.' &&
      buf[index + 2] === '.'
    ) {
      return true;
    }
    return false;
  }

  private isInsideUrl(buf: string, index: number): boolean {
    // Walk backward to find the start of the current word (avoid allocating substrings)
    let wordStart = index - 1;
    while (wordStart >= 0 && !SentenceBuffer.isWhitespace(buf[wordStart])) {
      wordStart--;
    }
    wordStart++; // move past the whitespace (or to 0)

    const word = buf.slice(wordStart, index + 1).toLowerCase();
    return (
      word.startsWith('http://') ||
      word.startsWith('https://') ||
      word.startsWith('www.')
    );
  }

  private isNumberedList(buf: string, index: number): boolean {
    // Pattern: digit(s) followed by period, but ONLY at the start of a line/sentence.
    // This avoids false positives on "The price is 5. That is final"
    if (index === 0) return false;
    let j = index - 1;
    while (j >= 0 && (buf[j] as string) >= '0' && (buf[j] as string) <= '9') {
      j--;
    }
    const digitCount = index - 1 - j;
    if (digitCount === 0) return false;

    // Only treat as numbered list if the number is at the start of the buffer
    // or preceded by a newline/sentence boundary (not just any space mid-sentence)
    if (j === -1) return true; // start of buffer
    if (buf[j] === '\n' || buf[j] === '\r') return true; // start of line

    // After a sentence boundary (". 1." or "! 1.") — check for space + prior terminator
    if (SentenceBuffer.isWhitespace(buf[j]) && j > 0) {
      const prev = buf[j - 1];
      if (prev === '.' || prev === '!' || prev === '?') return true;
    }

    return false;
  }

  private isAbbreviation(buf: string, index: number): boolean {
    // Check multi-dot abbreviations first (e.g., i.e., u.s., p.m.)
    for (const abbr of SentenceBuffer.MULTI_DOT_ABBREVIATIONS) {
      const start = index - abbr.length + 1;
      if (start >= 0) {
        const candidate = buf.slice(start, index + 1).toLowerCase();
        if (candidate === abbr) {
          // Must be at a word boundary
          if (start === 0 || SentenceBuffer.isWhitespace(buf[start - 1])) {
            return true;
          }
        }
      }
    }

    // Check single-word abbreviations: extract the word before the period
    let j = index - 1;
    while (j >= 0 && !SentenceBuffer.isWhitespace(buf[j])) {
      j--;
    }
    // Only match pure alphabetic words (no dots) to avoid false positives
    // like "e.s.t." matching "est"
    const word = buf.slice(j + 1, index);
    if (/\./.test(word)) return false; // contains dots — not a simple abbreviation
    return SentenceBuffer.ABBREVIATIONS.has(word.toLowerCase());
  }
}
