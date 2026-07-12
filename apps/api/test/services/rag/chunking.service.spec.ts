import { Test } from '@nestjs/testing';
import { ChunkingService } from '../../../src/modules/rag/chunking.service';
import { TokenCounterService } from '../../../src/modules/ai/token-counter.service';

describe('ChunkingService', () => {
  let service: ChunkingService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      // Real TokenCounterService — pure js-tiktoken, no I/O; chunk budgets
      // should be tested against the real tokenizer, not a fake.
      providers: [ChunkingService, TokenCounterService],
    }).compile();
    service = moduleRef.get(ChunkingService);
  });

  const paragraph = (i: number) =>
    `Paragraph ${i}. ` +
    'The quick brown fox jumps over the lazy dog and keeps running through the field. '.repeat(
      8,
    );

  const longText = Array.from({ length: 30 }, (_, i) => paragraph(i)).join(
    '\n\n',
  );

  describe('recursive', () => {
    it('returns a single chunk for short text', () => {
      const chunks = service.chunk('Hello world, short text.', 'recursive');
      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.content).toContain('Hello world');
      expect(chunks[0]!.chunkIndex).toBe(0);
    });

    it('splits long text into multiple chunks near the target size', () => {
      const chunks = service.chunk(longText, 'recursive');
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        // Target 512 + packing slack; nothing should balloon.
        expect(chunk.tokenCount).toBeLessThan(700);
      }
      // Sequential indexes.
      expect(chunks.map((c) => c.chunkIndex)).toEqual(
        chunks.map((_, i) => i),
      );
    });

    it('creates overlap between adjacent chunks', () => {
      const chunks = service.chunk(longText, 'recursive');
      // The head of chunk N+1 should repeat the tail of chunk N.
      const tailWords = chunks[0]!.content.split(/\s+/).slice(-5).join(' ');
      expect(chunks[1]!.content).toContain(tailWords);
    });

    it('returns [] for empty / whitespace text', () => {
      expect(service.chunk('', 'recursive')).toEqual([]);
      expect(service.chunk('   \n\n  ', 'recursive')).toEqual([]);
    });
  });

  describe('fixed', () => {
    it('produces token-bounded windows', () => {
      const chunks = service.chunk(longText, 'fixed');
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBeLessThan(700);
      }
    });

    it('single chunk for short text', () => {
      expect(service.chunk('tiny text', 'fixed')).toHaveLength(1);
    });
  });

  describe('markdown', () => {
    it('keeps small sections whole and tags them with their heading', () => {
      const md = [
        '# Refund policy',
        'Refunds are available within 30 days of purchase.',
        '',
        '## Shipping',
        'We ship worldwide within 5 business days.',
      ].join('\n');
      const chunks = service.chunk(md, 'markdown');
      expect(chunks.length).toBe(2);
      expect(chunks[0]!.metadata.sectionHeading).toBe('Refund policy');
      expect(chunks[0]!.content).toContain('30 days');
      expect(chunks[1]!.metadata.sectionHeading).toBe('Shipping');
    });

    it('recursively splits oversized sections, preserving the heading tag', () => {
      const md = `# Big section\n${longText}`;
      const chunks = service.chunk(md, 'markdown');
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.metadata.sectionHeading).toBe('Big section');
      }
    });

    it('degrades to recursive when no headings exist', () => {
      const chunks = service.chunk(longText, 'markdown');
      expect(chunks.length).toBeGreaterThan(1);
    });
  });

  describe('contentHash()', () => {
    it('is stable across whitespace + case differences', () => {
      expect(service.contentHash('Hello   World')).toBe(
        service.contentHash('hello world'),
      );
    });

    it('differs for different content', () => {
      expect(service.contentHash('a')).not.toBe(service.contentHash('b'));
    });
  });
});
