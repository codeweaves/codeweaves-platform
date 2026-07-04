import { Test } from '@nestjs/testing';
import { RagRetrievalService } from '../../../src/modules/rag/rag-retrieval.service';
import { EmbeddingService } from '../../../src/modules/rag/embedding.service';
import { PrismaService } from '../../../src/services/prisma.service';

describe('RagRetrievalService', () => {
  let service: RagRetrievalService;

  const agentId = 'agent-uuid';
  const orgId = 'org-uuid';

  const mockPrisma = {
    agentDocument: { findFirst: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };
  // Implementation assigned in beforeEach (jest resetMocks:true).
  const mockEmbedding = {
    embedQuery: jest.fn(),
  };

  const rawRow = {
    id: 'chunk-1',
    documentId: 'doc-1',
    content: 'Refunds within 30 days.',
    tokenCount: 8,
    metadata: { sectionHeading: 'Refunds' },
    documentName: 'policies.pdf',
    sourceType: 'FILE',
    sourceUrl: null,
    score: 0.87,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockEmbedding.embedQuery.mockResolvedValue([0.1, 0.2, 0.3]);
    // Searches run inside a transaction (SET LOCAL hnsw.ef_search); the tx
    // client delegates to the same mocked raw methods.
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $queryRaw: mockPrisma.$queryRaw,
          $executeRaw: mockPrisma.$executeRaw,
        }),
    );
    const moduleRef = await Test.createTestingModule({
      providers: [
        RagRetrievalService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmbeddingService, useValue: mockEmbedding },
      ],
    }).compile();
    service = moduleRef.get(RagRetrievalService);
  });

  describe('hasReadyDocuments()', () => {
    it('scopes the existence check by agent AND organization', async () => {
      mockPrisma.agentDocument.findFirst.mockResolvedValue({ id: 'doc-1' });
      expect(await service.hasReadyDocuments(agentId, orgId)).toBe(true);
      expect(mockPrisma.agentDocument.findFirst).toHaveBeenCalledWith({
        where: { agentId, organizationId: orgId, status: 'READY' },
        select: { id: true },
      });
    });

    it('returns false when nothing is indexed', async () => {
      mockPrisma.agentDocument.findFirst.mockResolvedValue(null);
      expect(await service.hasReadyDocuments(agentId, orgId)).toBe(false);
    });
  });

  describe('retrieve()', () => {
    const baseParams = {
      agentId,
      organizationId: orgId,
      query: 'what is the refund policy?',
      topK: 5,
      similarityThreshold: 0.7,
    } as const;

    it('embeds the query once and maps rows to RetrievedChunk', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([rawRow]);
      const chunks = await service.retrieve({
        ...baseParams,
        strategy: 'vector',
        sessionId: 'sess-1',
      });

      expect(mockEmbedding.embedQuery).toHaveBeenCalledWith(
        'what is the refund policy?',
        { organizationId: orgId, agentId, sessionId: 'sess-1' },
      );
      expect(chunks).toEqual([
        {
          chunkId: 'chunk-1',
          documentId: 'doc-1',
          documentName: 'policies.pdf',
          sourceType: 'FILE',
          sourceUrl: null,
          content: 'Refunds within 30 days.',
          tokenCount: 8,
          score: 0.87,
          metadata: { sectionHeading: 'Refunds' },
        },
      ]);
    });

    it.each(['vector', 'hybrid'] as const)(
      '%s SQL is tenant-scoped by agentId AND organizationId',
      async (strategy) => {
        mockPrisma.$queryRaw.mockResolvedValue([]);
        await service.retrieve({ ...baseParams, strategy });

        expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
        // $queryRaw is a tagged template: [strings, ...values]. Verify the
        // tenancy filters are bound parameters of the statement.
        const call = mockPrisma.$queryRaw.mock.calls[0];
        const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
        const sql = strings.join('?');
        expect(sql).toContain('"agentId" =');
        expect(sql).toContain('"organizationId" =');
        expect(values).toContain(agentId);
        expect(values).toContain(orgId);
      },
    );

    it('hybrid SQL fuses semantic + keyword arms with RRF', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);
      await service.retrieve({ ...baseParams, strategy: 'hybrid' });
      const [strings] = mockPrisma.$queryRaw.mock.calls[0] as [TemplateStringsArray];
      const sql = strings.join('?');
      expect(sql).toContain('WITH semantic AS');
      expect(sql).toContain('keyword AS');
      expect(sql).toContain('websearch_to_tsquery');
      expect(sql).toContain('UNION ALL');
    });

    it('vector SQL orders by cosine distance with a threshold', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);
      await service.retrieve({ ...baseParams, strategy: 'vector' });
      const [strings] = mockPrisma.$queryRaw.mock.calls[0] as [TemplateStringsArray];
      const sql = strings.join('?');
      expect(sql).toContain('<=>');
      expect(sql).not.toContain('websearch_to_tsquery');
    });

    it('normalises Decimal-ish scores to numbers', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ ...rawRow, score: '0.42' }]);
      const chunks = await service.retrieve({ ...baseParams, strategy: 'hybrid' });
      expect(chunks[0]!.score).toBeCloseTo(0.42);
    });
  });
});
