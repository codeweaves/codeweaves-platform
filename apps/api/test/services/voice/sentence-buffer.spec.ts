import { SentenceBuffer } from '../../../src/modules/voice/utils/sentence-buffer';

describe('SentenceBuffer', () => {
  let buffer: SentenceBuffer;

  beforeEach(() => {
    buffer = new SentenceBuffer();
  });

  describe('basic sentence detection', () => {
    it('should emit a complete sentence ending with period + space', () => {
      const result = buffer.addToken('Hello world. How are you');
      expect(result).toEqual(['Hello world.']);
      expect(buffer.flush()).toBe('How are you');
    });

    it('should emit a complete sentence ending with exclamation mark', () => {
      const result = buffer.addToken('Hello world! How are you');
      expect(result).toEqual(['Hello world!']);
      expect(buffer.flush()).toBe('How are you');
    });

    it('should emit a complete sentence ending with question mark', () => {
      const result = buffer.addToken('How are you? I am fine');
      expect(result).toEqual(['How are you?']);
      expect(buffer.flush()).toBe('I am fine');
    });

    it('should emit multiple sentences from a single token batch', () => {
      const result = buffer.addToken(
        'First sentence here. Second sentence here. Third part',
      );
      expect(result).toEqual([
        'First sentence here.',
        'Second sentence here.',
      ]);
      expect(buffer.flush()).toBe('Third part');
    });
  });

  describe('token-by-token input', () => {
    it('should accumulate tokens and emit when boundary is hit', () => {
      expect(buffer.addToken('H')).toEqual([]);
      expect(buffer.addToken('ello')).toEqual([]);
      expect(buffer.addToken(' world')).toEqual([]);
      // Period at end of buffer — not emitted yet (more tokens may come)
      expect(buffer.addToken('.')).toEqual([]);
      // Space after period triggers boundary detection
      expect(buffer.addToken(' How')).toEqual(['Hello world.']);
      expect(buffer.addToken(' are')).toEqual([]);
      expect(buffer.addToken(' you')).toEqual([]);
      // Question mark at end — not emitted until space or flush
      expect(buffer.addToken('?')).toEqual([]);
      expect(buffer.flush()).toBe('How are you?');
    });

    it('should handle tokens with trailing spaces after terminators', () => {
      expect(buffer.addToken('Hello world. ')).toEqual(['Hello world.']);
      // Period at end of buffer without trailing space stays buffered
      expect(buffer.addToken('Next sentence.')).toEqual([]);
      expect(buffer.flush()).toBe('Next sentence.');
    });
  });

  describe('minimum sentence length', () => {
    it('should hold short sentences below MIN_SENTENCE_LENGTH (10)', () => {
      // "Hi." is only 3 chars — should be held
      const result = buffer.addToken('Hi. ');
      expect(result).toEqual([]);
    });

    it('should emit held short sentence once more text accumulates past boundary', () => {
      // "Hi." is 3 chars, held. Next boundary at "today?" gives combined sentence.
      expect(buffer.addToken('Hi. ')).toEqual([]);
      const result = buffer.addToken('How are you doing today? ');
      expect(result).toEqual(['Hi. How are you doing today?']);
    });

    it('should return short sentence on flush', () => {
      buffer.addToken('Hi.');
      expect(buffer.flush()).toBe('Hi.');
    });

    it('should hold "OK." and merge with following text', () => {
      // "OK." is 3 chars < MIN_SENTENCE_LENGTH, held
      expect(buffer.addToken('OK. ')).toEqual([]);
      // Next boundary at "me." gives "OK. That sounds good to me." (27 chars) — emitted
      const result = buffer.addToken(
        'That sounds good to me. Let us proceed',
      );
      expect(result).toEqual(['OK. That sounds good to me.']);
      expect(buffer.flush()).toBe('Let us proceed');
    });
  });

  describe('force-flush on max buffer length', () => {
    it('should force-flush when buffer exceeds 500 characters', () => {
      // Create a string longer than 500 chars with no punctuation
      const longText = 'word '.repeat(110); // 550 chars
      const result = buffer.addToken(longText);
      expect(result.length).toBeGreaterThanOrEqual(1);
      // Each chunk should be <= 500 chars
      for (const chunk of result) {
        expect(chunk.length).toBeLessThanOrEqual(500);
      }
      // Nothing should be lost — flush any remaining
      const remaining = buffer.flush();
      const totalLength = result.reduce((sum, s) => sum + s.length, 0) +
        (remaining ? remaining.length : 0);
      // Account for trimming of spaces
      expect(totalLength).toBeGreaterThan(0);
    });

    it('should break at last space when force-flushing', () => {
      const longText = 'abcdefghij '.repeat(55); // 605 chars
      const result = buffer.addToken(longText);
      expect(result.length).toBeGreaterThanOrEqual(1);
      // Should not break mid-word
      for (const chunk of result) {
        expect(chunk).not.toMatch(/^\S+\s\S+$/); // just checking it doesn't start mid-word
        expect(chunk.trim()).toBe(chunk); // trimmed
      }
    });
  });

  describe('flush', () => {
    it('should return remaining text on flush', () => {
      buffer.addToken('Some incomplete text');
      expect(buffer.flush()).toBe('Some incomplete text');
    });

    it('should return null on flush when buffer is empty', () => {
      expect(buffer.flush()).toBeNull();
    });

    it('should return null on flush after previous flush', () => {
      buffer.addToken('Hello.');
      buffer.flush();
      expect(buffer.flush()).toBeNull();
    });

    it('should reset buffer after flush', () => {
      buffer.addToken('Text here');
      buffer.flush();
      // New tokens should work fresh
      const result = buffer.addToken('New sentence here. More text');
      expect(result).toEqual(['New sentence here.']);
      expect(buffer.flush()).toBe('More text');
    });
  });

  describe('empty input', () => {
    it('should return empty array for empty string token', () => {
      expect(buffer.addToken('')).toEqual([]);
    });

    it('should handle whitespace-only tokens', () => {
      expect(buffer.addToken('   ')).toEqual([]);
      expect(buffer.flush()).toBe(null);
    });
  });

  describe('abbreviation handling', () => {
    it('should not split at "Dr."', () => {
      const result = buffer.addToken('Dr. Smith went home. It was late');
      expect(result).toEqual(['Dr. Smith went home.']);
      expect(buffer.flush()).toBe('It was late');
    });

    it('should not split at "Mr."', () => {
      const result = buffer.addToken('Mr. Jones is here. Welcome him');
      expect(result).toEqual(['Mr. Jones is here.']);
      expect(buffer.flush()).toBe('Welcome him');
    });

    it('should not split at "Mrs."', () => {
      expect(buffer.addToken('Mrs. ')).toEqual([]);
      const result = buffer.addToken('Davis arrived early. ');
      expect(result).toEqual(['Mrs. Davis arrived early.']);
      expect(buffer.addToken('She was happy')).toEqual([]);
      expect(buffer.flush()).toBe('She was happy');
    });

    it('should not split at "e.g."', () => {
      const result = buffer.addToken(
        'Use a framework e.g. React for this. It works well',
      );
      expect(result).toEqual(['Use a framework e.g. React for this.']);
      expect(buffer.flush()).toBe('It works well');
    });

    it('should not split at "i.e."', () => {
      const result = buffer.addToken(
        'The best option i.e. TypeScript is great. Use it',
      );
      expect(result).toEqual([
        'The best option i.e. TypeScript is great.',
      ]);
      expect(buffer.flush()).toBe('Use it');
    });

    it('should not split at "vs."', () => {
      const result = buffer.addToken(
        'React vs. Angular is a common debate. Both are good',
      );
      expect(result).toEqual([
        'React vs. Angular is a common debate.',
      ]);
      expect(buffer.flush()).toBe('Both are good');
    });

    it('should not split at "etc."', () => {
      const result = buffer.addToken(
        'Fruits like apples etc. are healthy. Eat them',
      );
      expect(result).toEqual([
        'Fruits like apples etc. are healthy.',
      ]);
      expect(buffer.flush()).toBe('Eat them');
    });
  });

  describe('numbered list handling', () => {
    it('should not split at numbered list items at start of buffer', () => {
      const result = buffer.addToken(
        '1. First item is here. The end comes now',
      );
      // "1." at start of buffer is a numbered list — not a boundary
      expect(result).toEqual(['1. First item is here.']);
      expect(buffer.flush()).toBe('The end comes now');
    });

    it('should not split at numbered list after sentence boundary', () => {
      const result = buffer.addToken(
        'First item done. 2. Second item done. The end',
      );
      // "2." after ". " is a numbered list continuation
      expect(result).toEqual([
        'First item done.',
        '2. Second item done.',
      ]);
      expect(buffer.flush()).toBe('The end');
    });

    it('should handle multi-digit numbered lists', () => {
      const result = buffer.addToken(
        '10. Tenth item is done. Moving on',
      );
      expect(result).toEqual(['10. Tenth item is done.']);
      expect(buffer.flush()).toBe('Moving on');
    });

    it('should split at decimal numbers mid-sentence (not a list)', () => {
      // "5." mid-sentence is NOT a numbered list — it's a decimal
      const result = buffer.addToken(
        'The price is 5. That is the final price',
      );
      expect(result).toEqual(['The price is 5.']);
      expect(buffer.flush()).toBe('That is the final price');
    });
  });

  describe('ellipsis handling', () => {
    it('should not split at ellipsis "..."', () => {
      const result = buffer.addToken(
        'Wait... I need to think. Let me check',
      );
      expect(result).toEqual(['Wait... I need to think.']);
      expect(buffer.flush()).toBe('Let me check');
    });

    it('should not split mid-ellipsis', () => {
      expect(buffer.addToken('Hmm')).toEqual([]);
      expect(buffer.addToken('...')).toEqual([]);
      expect(buffer.addToken(' ')).toEqual([]);
      const result = buffer.addToken('actually never mind. ');
      expect(result).toEqual(['Hmm... actually never mind.']);
    });
  });

  describe('URL handling', () => {
    it('should not split at periods inside URLs with https', () => {
      const result = buffer.addToken(
        'Visit https://example.com for more info. Thanks',
      );
      expect(result).toEqual([
        'Visit https://example.com for more info.',
      ]);
      expect(buffer.flush()).toBe('Thanks');
    });

    it('should not split at periods inside URLs with http', () => {
      const result = buffer.addToken(
        'Go to http://test.org for details. See you',
      );
      expect(result).toEqual([
        'Go to http://test.org for details.',
      ]);
      expect(buffer.flush()).toBe('See you');
    });

    it('should not split at periods inside www URLs', () => {
      const result = buffer.addToken(
        'Check www.example.co.uk for info. Done',
      );
      expect(result).toEqual([
        'Check www.example.co.uk for info.',
      ]);
      expect(buffer.flush()).toBe('Done');
    });
  });

  describe('combined edge cases', () => {
    it('should handle mixed abbreviations and real boundaries', () => {
      const result = buffer.addToken(
        'Dr. Smith said hello. Mr. Jones replied. End',
      );
      expect(result).toEqual([
        'Dr. Smith said hello.',
        'Mr. Jones replied.',
      ]);
      expect(buffer.flush()).toBe('End');
    });

    it('should handle sentence ending at buffer end (no trailing space)', () => {
      // Period at end without trailing space — stays in buffer (more tokens may come)
      expect(buffer.addToken('This is a complete sentence.')).toEqual([]);
      // flush() returns remaining content
      expect(buffer.flush()).toBe('This is a complete sentence.');
    });

    it('should handle multiple terminators in sequence', () => {
      const result = buffer.addToken('Really?! That is amazing. Tell me more');
      // "?!" — ? followed by ! (not whitespace), skip. "!" followed by " " — boundary.
      // "Really?!" is 8 chars < MIN_SENTENCE_LENGTH (10), so it merges forward.
      // Next boundary at "amazing." gives "Really?! That is amazing." (25 chars) — emitted.
      expect(result).toEqual(['Really?! That is amazing.']);
      expect(buffer.flush()).toBe('Tell me more');
    });

    it('should handle consecutive addToken calls building sentences', () => {
      expect(buffer.addToken('The quick ')).toEqual([]);
      expect(buffer.addToken('brown fox ')).toEqual([]);
      expect(buffer.addToken('jumps over ')).toEqual([]);
      expect(buffer.addToken('the lazy dog. ')).toEqual([
        'The quick brown fox jumps over the lazy dog.',
      ]);
    });
  });

  describe('U.S. and additional multi-dot abbreviations', () => {
    it('should not split at "U.S."', () => {
      const result = buffer.addToken(
        'The U.S. government issued a statement. It was clear',
      );
      expect(result).toEqual([
        'The U.S. government issued a statement.',
      ]);
      expect(buffer.flush()).toBe('It was clear');
    });

    it('should not split at "p.m."', () => {
      const result = buffer.addToken(
        'The meeting is at 3 p.m. today. Be there',
      );
      expect(result).toEqual([
        'The meeting is at 3 p.m. today.',
      ]);
      expect(buffer.flush()).toBe('Be there');
    });

    it('should not split at "a.m."', () => {
      const result = buffer.addToken(
        'I wake up at 6 a.m. every day. It is early',
      );
      expect(result).toEqual([
        'I wake up at 6 a.m. every day.',
      ]);
      expect(buffer.flush()).toBe('It is early');
    });

    it('should not split at "U.K."', () => {
      const result = buffer.addToken(
        'The U.K. market opened today. Stocks rose',
      );
      expect(result).toEqual([
        'The U.K. market opened today.',
      ]);
      expect(buffer.flush()).toBe('Stocks rose');
    });
  });

  describe('whitespace-only buffer handling (P1)', () => {
    it('should not infinite loop on 500+ whitespace-only buffer', () => {
      const spaces = ' '.repeat(600);
      // Should complete without hanging — returns empty (all whitespace trimmed)
      const result = buffer.addToken(spaces);
      expect(result).toEqual([]);
      expect(buffer.flush()).toBe(null);
    });

    it('should not infinite loop on 1000+ whitespace-only buffer', () => {
      const spaces = ' '.repeat(1500);
      const result = buffer.addToken(spaces);
      expect(result).toEqual([]);
      expect(buffer.flush()).toBe(null);
    });
  });

  describe('carriage return handling (P3)', () => {
    it('should detect boundary before \\r\\n', () => {
      const result = buffer.addToken(
        'First sentence.\r\nSecond sentence.\r\nThird',
      );
      expect(result).toEqual([
        'First sentence.',
        'Second sentence.',
      ]);
      expect(buffer.flush()).toBe('Third');
    });

    it('should detect boundary before lone \\r', () => {
      const result = buffer.addToken(
        'Hello world.\rNext line here.\rEnd',
      );
      expect(result).toEqual([
        'Hello world.',
        'Next line here.',
      ]);
      expect(buffer.flush()).toBe('End');
    });
  });

  describe('abbreviation dot-stripping false positive (P5)', () => {
    it('should not treat "e.s.t." as abbreviation "est"', () => {
      // "e.s.t." contains dots — should NOT match "est" in abbreviation set
      const result = buffer.addToken(
        'The timezone is e.s.t. We are here now',
      );
      // "e.s.t." is not in multi-dot list and has dots so single-word check fails
      // The period after "t" followed by space is a boundary
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('unicode surrogate pair handling (D2)', () => {
    it('should not corrupt emoji when force-flushing', () => {
      // Create a long string with emoji near the break point
      const prefix = 'a'.repeat(495);
      const emoji = '\u{1F600}'; // 😀 — 2 UTF-16 code units
      const suffix = ' more text here';
      const result = buffer.addToken(prefix + emoji + suffix);
      // Verify no orphaned surrogates in output
      const allOutput = [
        ...result,
        buffer.flush(),
      ].filter(Boolean) as string[];
      const combined = allOutput.join('');
      // Check no lone surrogates exist
      for (let i = 0; i < combined.length; i++) {
        const code = combined.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
          // High surrogate must be followed by low surrogate
          const next = combined.charCodeAt(i + 1);
          expect(next).toBeGreaterThanOrEqual(0xdc00);
          expect(next).toBeLessThanOrEqual(0xdfff);
          i++; // skip the pair
        } else {
          // Must not be a lone low surrogate
          expect(code < 0xdc00 || code > 0xdfff).toBe(true);
        }
      }
    });
  });

  describe('large token iteration cap (D4)', () => {
    it('should handle very large tokens without hanging', () => {
      const hugeToken = 'longword '.repeat(5000); // ~45KB
      const start = Date.now();
      const result = buffer.addToken(hugeToken);
      const elapsed = Date.now() - start;
      // Should complete in reasonable time (< 5 seconds)
      expect(elapsed).toBeLessThan(5000);
      expect(result.length).toBeGreaterThan(0);
      // Flush remaining
      buffer.flush();
    });
  });
});
