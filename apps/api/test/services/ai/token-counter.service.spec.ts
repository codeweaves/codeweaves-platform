import { Test } from '@nestjs/testing';
import type { ModelMessage } from 'ai';
import { TokenCounterService } from '../../../src/modules/ai/token-counter.service';

describe('TokenCounterService', () => {
  let service: TokenCounterService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [TokenCounterService],
    }).compile();
    service = moduleRef.get(TokenCounterService);
  });

  describe('countTokens()', () => {
    it('returns 0 for empty input', () => {
      expect(service.countTokens('')).toBe(0);
    });

    it('returns a positive integer for non-empty text', () => {
      const count = service.countTokens('Hello, world!');
      expect(count).toBeGreaterThan(0);
      expect(Number.isInteger(count)).toBe(true);
    });

    it('longer text yields more tokens than shorter text', () => {
      const short = service.countTokens('Hi');
      const long = service.countTokens(
        'This is a much longer string with many more tokens to count.',
      );
      expect(long).toBeGreaterThan(short);
    });

    it('uses cl100k_base by default (matches GPT-3.5/4 family)', () => {
      // "Hello world" is exactly 2 tokens in cl100k_base.
      expect(service.countTokens('Hello world')).toBe(2);
    });

    it('accepts a model name and returns a count', () => {
      const count = service.countTokens('Hello world', 'gpt-4o-mini');
      expect(count).toBeGreaterThan(0);
    });

    it('falls back gracefully on unknown model names', () => {
      // Should not throw — falls back to cl100k_base.
      const count = service.countTokens('Hello world', 'totally-fake-model-9000');
      expect(count).toBeGreaterThan(0);
    });

    it('strips OpenRouter-style provider/model prefix', () => {
      const a = service.countTokens('Hello world', 'openai/gpt-4o-mini');
      const b = service.countTokens('Hello world', 'gpt-4o-mini');
      expect(a).toBe(b);
    });

    it('strips colon-style provider:model prefix', () => {
      // groq:llama-3.3-70b-versatile is unknown to tiktoken; falls back to
      // cl100k. Just assert it doesn't throw and returns positive.
      const count = service.countTokens(
        'Hello world',
        'groq:llama-3.3-70b-versatile',
      );
      expect(count).toBeGreaterThan(0);
    });

    it('caches the encoder for the same model name across calls', () => {
      // Two calls with same model should both work and produce identical counts.
      const a = service.countTokens('Cache test', 'gpt-4o-mini');
      const b = service.countTokens('Cache test', 'gpt-4o-mini');
      expect(a).toBe(b);
    });
  });

  describe('countMessages()', () => {
    it('returns 0 for empty array', () => {
      expect(service.countMessages([])).toBe(0);
    });

    it('counts string-content messages with per-message overhead', () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: 'Hello world' },
      ];
      // 2 content tokens + 4 framing overhead.
      expect(service.countMessages(messages)).toBe(6);
    });

    it('counts array-content messages summing only text parts', () => {
      const messages: ModelMessage[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello world' },
          ],
        },
      ];
      // 2 content tokens + 4 framing overhead = 6.
      expect(service.countMessages(messages)).toBe(6);
    });

    it('ignores non-text content parts (images, tool results)', () => {
      const messages: ModelMessage[] = [
        {
          role: 'user',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          content: [{ type: 'image', image: 'data:image/png;base64,xxx' } as any],
        },
      ];
      // Only the per-message overhead (4) — no text parts.
      expect(service.countMessages(messages)).toBe(4);
    });

    it('sums multiple messages with separate overheads', () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: 'Hello world' },
        { role: 'assistant', content: 'Hi there' },
      ];
      // (2 + 4) + (>=2 + 4) — exact second-message count depends on BPE; just
      // assert total is greater than the first.
      const total = service.countMessages(messages);
      expect(total).toBeGreaterThan(service.countMessages([messages[0]!]));
    });

    it('handles unusual content types by returning 0 content tokens', () => {
      const messages: ModelMessage[] = [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { role: 'user', content: 42 as any },
      ];
      // 4 framing overhead, no content.
      expect(service.countMessages(messages)).toBe(4);
    });
  });

  describe('countPromptContext()', () => {
    it('counts system prompt + messages together', () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: 'Hello world' },
      ];
      // System "Hello world" (2 + 4) + user message (2 + 4) = 12.
      expect(service.countPromptContext('Hello world', messages)).toBe(12);
    });

    it('skips empty system prompt cleanly', () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: 'Hello world' },
      ];
      expect(service.countPromptContext('', messages)).toBe(6);
    });

    it('accepts model override and produces a positive integer', () => {
      const count = service.countPromptContext(
        'System',
        [{ role: 'user', content: 'Hi' }],
        'gpt-4o-mini',
      );
      expect(count).toBeGreaterThan(0);
    });
  });
});
