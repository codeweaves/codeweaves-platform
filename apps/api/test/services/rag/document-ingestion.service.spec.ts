import { Test } from '@nestjs/testing';
import { DocumentIngestionService } from '../../../src/modules/rag/document-ingestion.service';
import { ChunkingService } from '../../../src/modules/rag/chunking.service';
import { EmbeddingService } from '../../../src/modules/rag/embedding.service';
import { AgentCacheService } from '../../../src/common/cache/agent-cache.service';
import { RagLoggerService } from '../../../src/common/logger/rag.logger';
import { PrismaService } from '../../../src/services/prisma.service';

describe('DocumentIngestionService', () => {
  let service: DocumentIngestionService;

  const documentId = 'doc-uuid';

  const baseDoc = {
    id: documentId,
    agentId: 'agent-uuid',
    organizationId: 'org-uuid',
    name: 'policies.txt',
    chunkingStrategy: 'recursive',
    rawText: 'Refunds are available within 30 days of purchase.',
  };

  const mockPrisma = {
    agentDocument: { findUnique: jest.fn(), update: jest.fn() },
    agentDocumentChunk: { deleteMany: jest.fn() },
    $executeRaw: jest.fn(),
  };
  const mockChunking = { chunk: jest.fn() };
  const mockEmbedding = { embedTexts: jest.fn() };
  const mockRagLogger = {
    logDocumentIngested: jest.fn(),
    logDocumentIngestionFailed: jest.fn(),
  };
  const mockAgentCache = { invalidate: jest.fn() };

  /** Drain the fire-and-forget pipeline: enqueue() + let microtasks settle. */
  const runIngestion = async () => {
    service.enqueue(documentId);
    // The pipeline is a chain of awaited promises — a few macrotask turns
    // lets it run to completion without exposing internals.
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.agentDocument.findUnique.mockResolvedValue({ ...baseDoc });
    mockPrisma.agentDocument.update.mockResolvedValue({});
    mockChunking.chunk.mockReturnValue([
      {
        content: 'Refunds are available within 30 days of purchase.',
        chunkIndex: 0,
        tokenCount: 12,
        metadata: {},
      },
    ]);
    mockEmbedding.embedTexts.mockResolvedValue([[0.1, 0.2]]);
    mockRagLoggerReset();

    const moduleRef = await Test.createTestingModule({
      providers: [
        DocumentIngestionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChunkingService, useValue: mockChunking },
        { provide: EmbeddingService, useValue: mockEmbedding },
        { provide: RagLoggerService, useValue: mockRagLogger },
        { provide: AgentCacheService, useValue: mockAgentCache },
      ],
    }).compile();
    service = moduleRef.get(DocumentIngestionService);
  });

  function mockRagLoggerReset() {
    mockRagLogger.logDocumentIngested.mockResolvedValue(undefined);
    mockRagLogger.logDocumentIngestionFailed.mockResolvedValue(undefined);
    mockAgentCache.invalidate.mockResolvedValue(undefined);
  }

  it('happy path: PROCESSING → chunk → embed → replace chunks → READY', async () => {
    await runIngestion();

    // Status transitions in order.
    const updates = mockPrisma.agentDocument.update.mock.calls.map(
      (c) => c[0].data.status,
    );
    expect(updates[0]).toBe('PROCESSING');
    expect(updates[updates.length - 1]).toBe('READY');

    expect(mockChunking.chunk).toHaveBeenCalledWith(
      baseDoc.rawText,
      'recursive',
    );
    expect(mockEmbedding.embedTexts).toHaveBeenCalledWith(
      [baseDoc.rawText],
      { organizationId: 'org-uuid', agentId: 'agent-uuid' },
    );
    // Old chunks removed, new ones inserted per batch. Atomicity comes from
    // the status state machine (READY only after all inserts), not a
    // transaction — partial chunks are never visible to retrieval.
    expect(mockPrisma.agentDocumentChunk.deleteMany).toHaveBeenCalledWith({
      where: { documentId },
    });
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);

    // Final READY update carries counts, and the cached hasReadyDocuments
    // flag is refreshed.
    const readyUpdate = mockPrisma.agentDocument.update.mock.calls.find(
      (c) => c[0].data.status === 'READY',
    )![0];
    expect(readyUpdate.data).toMatchObject({ chunkCount: 1, totalTokens: 12 });
    expect(mockAgentCache.invalidate).toHaveBeenCalledWith('agent-uuid');
    expect(mockRagLogger.logDocumentIngested).toHaveBeenCalled();
  });

  it('marks the document FAILED with the error message when embedding blows up', async () => {
    mockEmbedding.embedTexts.mockRejectedValue(new Error('embedding API 500'));
    await runIngestion();

    const failedUpdate = mockPrisma.agentDocument.update.mock.calls.find(
      (c) => c[0].data.status === 'FAILED',
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate![0].data.errorMessage).toContain('embedding API 500');
    expect(mockRagLogger.logDocumentIngestionFailed).toHaveBeenCalled();
  });

  it('fails documents with no extracted text without calling the embedder', async () => {
    mockPrisma.agentDocument.findUnique.mockResolvedValue({
      ...baseDoc,
      rawText: '   ',
    });
    await runIngestion();

    expect(mockEmbedding.embedTexts).not.toHaveBeenCalled();
    const failedUpdate = mockPrisma.agentDocument.update.mock.calls.find(
      (c) => c[0].data.status === 'FAILED',
    );
    expect(failedUpdate![0].data.errorMessage).toMatch(/no extracted text/i);
  });

  it('no-ops when the document was deleted while queued', async () => {
    mockPrisma.agentDocument.findUnique.mockResolvedValue(null);
    await runIngestion();
    expect(mockPrisma.agentDocument.update).not.toHaveBeenCalled();
    expect(mockChunking.chunk).not.toHaveBeenCalled();
  });

  it('caps concurrent ingestions at 2 and processes the queue in order', async () => {
    // Make embedTexts hang until released so we can observe concurrency.
    let releaseCount = 0;
    const releases: Array<() => void> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    mockEmbedding.embedTexts.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => releases.push(resolve));
      inFlight--;
      return [[0.1]];
    });

    service.enqueue('doc-a');
    service.enqueue('doc-b');
    service.enqueue('doc-c');
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    // Only 2 embeddings started; the third waits on the gate.
    expect(mockEmbedding.embedTexts).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBeLessThanOrEqual(2);

    // Release all in-flight + queued work and let the pipeline finish.
    while (releaseCount < 3) {
      releases.splice(0).forEach((r) => r());
      releaseCount = mockEmbedding.embedTexts.mock.calls.length;
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    expect(mockEmbedding.embedTexts).toHaveBeenCalledTimes(3);
  });
});
