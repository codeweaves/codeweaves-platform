import { randomUUID } from 'node:crypto';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AgentCacheService } from '../../common/cache/agent-cache.service';
import { RagLoggerService } from '../../common/logger/rag.logger';
import { PrismaService } from '../../services/prisma.service';

import { ChunkingService, type ChunkData } from './chunking.service';
import { EmbeddingService } from './embedding.service';

/**
 * How many documents may be chunk+embedded concurrently per API instance.
 * Ingestion is CPU-light (tokenising) + network-bound (embedding API); 2 keeps
 * the event loop responsive for chat traffic.
 */
const MAX_CONCURRENT_INGESTIONS = 2;

/** Chunk rows inserted per statement — keeps each INSERT well under limits. */
const INSERT_BATCH_SIZE = 50;

/**
 * DocumentIngestionService: the background pipeline that turns an
 * AgentDocument's extracted text into embedded, searchable chunks.
 *
 *   enqueue() → [gate: max 2 concurrent] → PROCESSING → chunk → embed →
 *   replace chunks (transaction) → READY (or FAILED with errorMessage)
 *
 * Runs IN-PROCESS, deliberately not on a queue: BullMQ was removed from this
 * codebase (Redis cost reduction — see project memory) and document ingestion
 * is a low-frequency dashboard action where "the API restarts mid-ingestion"
 * simply leaves the document PENDING/PROCESSING; the operator re-indexes from
 * the UI. Text extraction already happened synchronously at upload time, so
 * this stage never needs the original file.
 *
 * Observability: audit events via RagLoggerService (fire-and-forget, never
 * breaks the pipeline) + LlmUsage rows for embedding spend (EmbeddingService).
 */
@Injectable()
export class DocumentIngestionService {
  private readonly logger = new Logger(DocumentIngestionService.name);

  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly chunking: ChunkingService,
    private readonly embedding: EmbeddingService,
    private readonly ragLogger: RagLoggerService,
    private readonly agentCache: AgentCacheService,
  ) {}

  /**
   * Fire-and-forget ingestion. Callers (upload / URL / re-index endpoints)
   * return to the client immediately; the dashboard polls document status.
   */
  enqueue(documentId: string): void {
    void this.runGated(documentId).catch((err) => {
      // runGated already records FAILED status; this catch is the last-resort
      // guard so an unexpected error can never become an unhandled rejection.
      this.logger.error(
        `Ingestion crashed for document ${documentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  private async runGated(documentId: string): Promise<void> {
    if (this.active >= MAX_CONCURRENT_INGESTIONS) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active++;
    try {
      await this.process(documentId);
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  private async process(documentId: string): Promise<void> {
    // Narrow select — rawText can be megabytes; never drag along fields the
    // pipeline doesn't use.
    const doc = await this.prisma.agentDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        agentId: true,
        organizationId: true,
        name: true,
        chunkingStrategy: true,
        rawText: true,
      },
    });
    if (!doc) return; // deleted while queued
    if (!doc.rawText || !doc.rawText.trim()) {
      await this.fail(documentId, doc.agentId, 'Document has no extracted text.');
      return;
    }

    const startedAt = performance.now();
    await this.prisma.agentDocument.update({
      where: { id: documentId },
      data: { status: 'PROCESSING', errorMessage: null },
    });

    try {
      // 1. Chunk (synchronous CPU work — yield once around it so a large
      // document doesn't monopolise the event loop back-to-back with I/O).
      await yieldToEventLoop();
      const chunks = this.chunking.chunk(
        doc.rawText,
        doc.chunkingStrategy as 'recursive' | 'fixed' | 'markdown',
      );
      if (chunks.length === 0) {
        await this.fail(documentId, doc.agentId, 'Text produced no indexable chunks.');
        return;
      }

      // 2+3. Embed + insert PER BATCH, not whole-document: peak memory is one
      // batch of vectors (~50 × 1536 floats) instead of every vector at once,
      // and no long-lived transaction pins a pool connection (a 2000-chunk
      // document would blow Prisma's 5s interactive-transaction default).
      //
      // Atomicity comes from the STATUS state machine, not a transaction:
      // retrieval only ever joins status='READY' documents, and status stays
      // PENDING/PROCESSING for the whole replace window — partially-written
      // chunks are never visible. A mid-flight crash leaves the document
      // recoverable via re-index.
      await this.prisma.agentDocumentChunk.deleteMany({ where: { documentId } });
      let totalTokens = 0;
      for (let i = 0; i < chunks.length; i += INSERT_BATCH_SIZE) {
        const batch = chunks.slice(i, i + INSERT_BATCH_SIZE);
        const vectors = await this.embedding.embedTexts(
          batch.map((c) => c.content),
          { organizationId: doc.organizationId, agentId: doc.agentId },
        );
        await this.insertChunkBatch(doc, batch, vectors);
        totalTokens += batch.reduce((sum, c) => sum + c.tokenCount, 0);
      }

      await this.prisma.agentDocument.update({
        where: { id: documentId },
        data: {
          status: 'READY',
          chunkCount: chunks.length,
          totalTokens,
          errorMessage: null,
        },
      });
      // The cached hasReadyDocuments flag just (possibly) flipped.
      await this.agentCache.invalidate(doc.agentId);

      const durationMs = Math.round(performance.now() - startedAt);
      this.logger.log(
        `[ingest] - document ${documentId} ready: ${chunks.length} chunks, ${totalTokens} tokens, ${durationMs}ms (${doc.chunkingStrategy})`,
      );
      void this.ragLogger.logDocumentIngested(doc.agentId, {
        documentId,
        name: doc.name,
        chunkCount: chunks.length,
        totalTokens,
        chunkingStrategy: doc.chunkingStrategy,
        durationMs,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.fail(documentId, doc.agentId, message);
      void this.ragLogger.logDocumentIngestionFailed(doc.agentId, err, {
        documentId,
        name: doc.name,
      });
    }
  }

  /**
   * Raw-SQL batch insert — Prisma has no native pgvector type, so embeddings
   * go in as `'[0.1,0.2,…]'::vector` literals. The generated searchVector
   * column populates itself.
   */
  private async insertChunkBatch(
    doc: { id: string; organizationId: string; agentId: string },
    batch: ChunkData[],
    vectors: number[][],
  ): Promise<void> {
    const rows = batch.map((chunk, i) => {
      const vector = vectors[i];
      if (!vector) {
        throw new Error(
          `Missing embedding for chunk ${chunk.chunkIndex} of document ${doc.id}`,
        );
      }
      return Prisma.sql`(
        ${randomUUID()}, ${doc.id}, ${doc.organizationId}, ${doc.agentId},
        ${chunk.chunkIndex}, ${chunk.content}, ${chunk.tokenCount},
        ${`[${vector.join(',')}]`}::vector,
        ${JSON.stringify(chunk.metadata)}::jsonb
      )`;
    });

    await this.prisma.$executeRaw`
      INSERT INTO "agent_document_chunks"
        ("id", "documentId", "organizationId", "agentId",
         "chunkIndex", "content", "tokenCount", "embedding", "metadata")
      VALUES ${Prisma.join(rows)}
    `;
  }

  private async fail(
    documentId: string,
    agentId: string,
    message: string,
  ): Promise<void> {
    this.logger.warn(`[ingest] - document ${documentId} failed: ${message}`);
    await this.prisma.agentDocument
      .update({
        where: { id: documentId },
        data: { status: 'FAILED', errorMessage: message.slice(0, 2000) },
      })
      .catch(() => undefined); // document deleted mid-flight — nothing to record
    // A re-index failure can flip hasReadyDocuments (READY → FAILED).
    await this.agentCache.invalidate(agentId).catch(() => undefined);
  }
}
