import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { ChunkingStrategy } from '@repo/validation';

import { TokenCounterService } from '../ai/token-counter.service';

/** Target chunk size. 512 tokens is the benchmark sweet spot (RAG research §2). */
const TARGET_TOKENS = 512;
/** ~10% overlap keeps context continuity between adjacent chunks. */
const OVERLAP_TOKENS = 50;
/** Chunks below this are merged into their neighbour — fragments hurt recall. */
const MIN_CHUNK_TOKENS = 24;
/** Hard ceiling on chunks per document (25 docs × 2000 = 50K rows worst case). */
const MAX_CHUNKS_PER_DOCUMENT = 2000;

export interface ChunkData {
  content: string;
  chunkIndex: number;
  tokenCount: number;
  metadata: {
    /** Nearest preceding markdown/underlined heading, when detectable. */
    sectionHeading?: string;
  };
}

/**
 * ChunkingService: splits extracted document text into retrieval-sized chunks.
 *
 * Three strategies (picked per agent via aiConfig.ragChunkingStrategy; every
 * document remembers which one it was indexed with):
 *
 *   'recursive' — split on paragraph → line → sentence → word boundaries,
 *                  greedily packing up to TARGET_TOKENS with OVERLAP_TOKENS of
 *                  carry-over. The proven general-purpose default (69% on the
 *                  2026 chunking benchmarks, see rag-pipeline-deep-research §2).
 *   'fixed'     — fixed token windows with overlap, ignoring structure.
 *                  Predictable and cheapest; fine for homogeneous prose.
 *   'markdown'  — split on heading boundaries first so sections stay whole,
 *                  then recursive within oversized sections. Chunks carry their
 *                  section heading in metadata (better citations).
 *
 * Token counts use the real tokenizer (js-tiktoken via TokenCounterService) so
 * chunk budgets match what the embedding model actually sees.
 */
@Injectable()
export class ChunkingService {
  constructor(private readonly tokenCounter: TokenCounterService) {}

  chunk(text: string, strategy: ChunkingStrategy): ChunkData[] {
    const normalised = text.replace(/\r\n/g, '\n').trim();
    if (!normalised) return [];

    let chunks: ChunkData[];
    switch (strategy) {
      case 'fixed':
        chunks = this.fixedChunks(normalised);
        break;
      case 'markdown':
        chunks = this.markdownChunks(normalised);
        break;
      case 'recursive':
      default:
        chunks = this.recursiveChunks(normalised);
        break;
    }

    return chunks.slice(0, MAX_CHUNKS_PER_DOCUMENT).map((c, i) => ({
      ...c,
      chunkIndex: i,
    }));
  }

  /** SHA-256 of normalised text — dedup + change detection on re-index. */
  contentHash(text: string): string {
    return createHash('sha256')
      .update(text.replace(/\s+/g, ' ').trim().toLowerCase())
      .digest('hex');
  }

  // --------------------------------------------------------------------------
  // recursive
  // --------------------------------------------------------------------------

  private recursiveChunks(text: string): ChunkData[] {
    const pieces = this.splitRecursive(text, ['\n\n', '\n', '. ', ' ']);
    return this.packPieces(pieces);
  }

  /**
   * Split `text` into pieces no larger than TARGET_TOKENS, trying the
   * separators in order — only descending to a finer separator for pieces
   * that are still too large. Keeps semantic units (paragraphs, sentences)
   * intact wherever they fit.
   */
  private splitRecursive(text: string, separators: string[]): string[] {
    if (this.tokenCounter.countTokens(text) <= TARGET_TOKENS) {
      return text.trim() ? [text] : [];
    }
    const [sep, ...rest] = separators;
    if (!sep) {
      // No separators left — hard-split by character estimate (~4 chars/token).
      const maxChars = TARGET_TOKENS * 4;
      const out: string[] = [];
      for (let i = 0; i < text.length; i += maxChars) {
        out.push(text.slice(i, i + maxChars));
      }
      return out;
    }
    const parts = text.split(sep);
    // Re-attach the separator so sentence/paragraph boundaries survive.
    const restored = parts.map((p, i) =>
      i < parts.length - 1 ? p + sep : p,
    );
    return restored.flatMap((part) =>
      part.trim() ? this.splitRecursive(part, rest) : [],
    );
  }

  /**
   * Greedily pack small pieces into chunks up to TARGET_TOKENS, carrying the
   * tail of the previous chunk forward as overlap.
   *
   * ONE flush path for both the mid-loop and final chunk (the final flush
   * differs only in `seedOverlap`) — the merge-or-push rule must never fork.
   */
  private packPieces(pieces: string[], heading?: string): ChunkData[] {
    const chunks: ChunkData[] = [];
    let current = '';
    let currentTokens = 0;

    const flush = (seedOverlap: boolean) => {
      const trimmed = current.trim();
      if (!trimmed) return;
      // The final flush may hold nothing but the previous chunk's overlap
      // carry-over — emitting it would duplicate content verbatim.
      if (
        !seedOverlap &&
        chunks.length > 0 &&
        chunks[chunks.length - 1]!.content.endsWith(trimmed)
      ) {
        return;
      }
      const tokenCount = this.tokenCounter.countTokens(trimmed);
      if (tokenCount < MIN_CHUNK_TOKENS && chunks.length > 0) {
        // Too small to stand alone — merge into the previous chunk.
        const prev = chunks[chunks.length - 1]!;
        prev.content = `${prev.content}\n${trimmed}`;
        prev.tokenCount = this.tokenCounter.countTokens(prev.content);
      } else {
        chunks.push({
          content: trimmed,
          chunkIndex: chunks.length,
          tokenCount,
          metadata: heading ? { sectionHeading: heading } : {},
        });
      }
      // Overlap: seed the next chunk with the tail of this one.
      current = seedOverlap ? overlapTail(trimmed, OVERLAP_TOKENS) : '';
      currentTokens = current
        ? this.tokenCounter.countTokens(current)
        : 0;
    };

    for (const piece of pieces) {
      const pieceTokens = this.tokenCounter.countTokens(piece);
      if (currentTokens + pieceTokens > TARGET_TOKENS && currentTokens > 0) {
        flush(true);
      }
      current += (current && !current.endsWith('\n') ? ' ' : '') + piece;
      currentTokens += pieceTokens;
    }
    flush(false);
    return chunks;
  }

  // --------------------------------------------------------------------------
  // fixed
  // --------------------------------------------------------------------------

  private fixedChunks(text: string): ChunkData[] {
    // Windowed by words (token counting per window keeps budgets honest
    // without tokenising per word).
    const words = text.split(/\s+/);
    const chunks: ChunkData[] = [];
    // ~0.75 words per token for English prose → step sized to land near the
    // target, then verified with the real tokenizer.
    const approxWordsPerChunk = Math.floor(TARGET_TOKENS * 0.75);
    const overlapWords = Math.floor(OVERLAP_TOKENS * 0.75);

    for (
      let start = 0;
      start < words.length;
      start += approxWordsPerChunk - overlapWords
    ) {
      const slice = words.slice(start, start + approxWordsPerChunk).join(' ');
      if (!slice.trim()) continue;
      chunks.push({
        content: slice,
        chunkIndex: chunks.length,
        tokenCount: this.tokenCounter.countTokens(slice),
        metadata: {},
      });
      if (start + approxWordsPerChunk >= words.length) break;
    }
    return chunks;
  }

  // --------------------------------------------------------------------------
  // markdown (heading-aware)
  // --------------------------------------------------------------------------

  private markdownChunks(text: string): ChunkData[] {
    const sections = splitByHeadings(text);
    const out: ChunkData[] = [];
    for (const section of sections) {
      const body = section.body.trim();
      if (!body) continue;
      if (this.tokenCounter.countTokens(body) <= TARGET_TOKENS) {
        out.push({
          content: body,
          chunkIndex: out.length,
          tokenCount: this.tokenCounter.countTokens(body),
          metadata: section.heading ? { sectionHeading: section.heading } : {},
        });
      } else {
        // Oversized section → recursive within, tagged with its heading.
        const pieces = this.splitRecursive(body, ['\n\n', '\n', '. ', ' ']);
        out.push(...this.packPieces(pieces, section.heading));
      }
    }
    // Documents with no headings degrade gracefully to recursive.
    return out.length > 0 ? out : this.recursiveChunks(text);
  }
}

// ============================================================================
// Helpers — free functions, trivially testable
// ============================================================================

/** Last ~N tokens of `text` (approximated by words), used as chunk overlap. */
function overlapTail(text: string, overlapTokens: number): string {
  const words = text.split(/\s+/);
  const overlapWords = Math.floor(overlapTokens * 0.75);
  if (words.length <= overlapWords) return '';
  return words.slice(-overlapWords).join(' ');
}

interface MarkdownSection {
  heading?: string;
  body: string;
}

/**
 * Split on markdown ATX headings (#..######). The heading line stays at the
 * top of its section's body so retrieval sees it too.
 */
function splitByHeadings(text: string): MarkdownSection[] {
  const lines = text.split('\n');
  const sections: MarkdownSection[] = [];
  let heading: string | undefined;
  let buffer: string[] = [];

  const push = () => {
    if (buffer.length > 0) {
      sections.push({ heading, body: buffer.join('\n') });
    }
    buffer = [];
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (match) {
      push();
      heading = match[2]!.trim();
      buffer.push(line); // keep the heading text inside the chunk
    } else {
      buffer.push(line);
    }
  }
  push();
  return sections;
}
