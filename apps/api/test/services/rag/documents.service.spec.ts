import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { DocumentsService } from '../../../src/modules/rag/documents.service';
import { DocumentIngestionService } from '../../../src/modules/rag/document-ingestion.service';
import { UrlFetcherService } from '../../../src/modules/rag/url-fetcher.service';
import { ChunkingService } from '../../../src/modules/rag/chunking.service';
import { RagLoggerService } from '../../../src/common/logger/rag.logger';
import { PrismaService } from '../../../src/services/prisma.service';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('DocumentsService', () => {
  let service: DocumentsService;

  const agentId = 'agent-uuid';
  const orgId = 'org-uuid';

  const mockPrisma = {
    agent: { findFirst: jest.fn(), findUnique: jest.fn() },
    agentDocument: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  };
  const mockIngestion = { enqueue: jest.fn() };
  const mockUrlFetcher = { fetchPage: jest.fn() };
  // NB: implementations assigned in beforeEach — jest resetMocks:true wipes
  // module-scope mockReturnValue/mockImplementation before every test.
  const mockChunking = { contentHash: jest.fn() };
  const mockRagLogger = {
    logDocumentCreated: jest.fn(),
    logDocumentReindexed: jest.fn(),
    logDocumentDeleted: jest.fn(),
  };

  const clientUser = {
    clerkId: 'clerk_1',
    email: 'client@org.com',
    id: 'user-uuid',
    role: Role.CLIENT,
    organizationId: orgId,
    organization: null,
  } as unknown as CurrentUserData;

  const makeFile = (
    overrides: Partial<Express.Multer.File> = {},
  ): Express.Multer.File => ({
    fieldname: 'file',
    originalname: 'policies.txt',
    encoding: '7bit',
    mimetype: 'text/plain',
    size: 100,
    buffer: Buffer.from('Our refund policy allows returns within 30 days.'),
    destination: '',
    filename: '',
    path: '',
    stream: undefined as never,
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockChunking.contentHash.mockReturnValue('hash123');
    mockRagLogger.logDocumentCreated.mockResolvedValue(undefined);
    mockRagLogger.logDocumentReindexed.mockResolvedValue(undefined);
    mockRagLogger.logDocumentDeleted.mockResolvedValue(undefined);
    mockPrisma.agent.findFirst.mockResolvedValue({
      id: agentId,
      organizationId: orgId,
    });
    mockPrisma.agent.findUnique.mockResolvedValue({ aiConfig: null });
    mockPrisma.agentDocument.count.mockResolvedValue(0);
    mockPrisma.agentDocument.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'doc-uuid', ...data }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DocumentIngestionService, useValue: mockIngestion },
        { provide: UrlFetcherService, useValue: mockUrlFetcher },
        { provide: ChunkingService, useValue: mockChunking },
        { provide: RagLoggerService, useValue: mockRagLogger },
      ],
    }).compile();
    service = moduleRef.get(DocumentsService);
  });

  describe('tenant isolation', () => {
    it('scopes the agent lookup by organizationId for CLIENT users', async () => {
      mockPrisma.agentDocument.findMany.mockResolvedValue([]);
      await service.list(agentId, clientUser);
      expect(mockPrisma.agent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: orgId }),
        }),
      );
    });

    it("404s when the agent belongs to another org", async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);
      await expect(service.list(agentId, clientUser)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.agentDocument.findMany).not.toHaveBeenCalled();
    });
  });

  describe('uploadFile()', () => {
    it('extracts text, creates a PENDING document and enqueues ingestion', async () => {
      const doc = await service.uploadFile(agentId, makeFile(), clientUser);
      expect(mockPrisma.agentDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agentId,
            organizationId: orgId, // denormalised tenant scope
            sourceType: 'FILE',
            status: 'PENDING',
            chunkingStrategy: 'recursive', // schema default
            rawText: expect.stringContaining('refund policy'),
          }),
        }),
      );
      expect(mockIngestion.enqueue).toHaveBeenCalledWith('doc-uuid');
      expect(doc).toMatchObject({ name: 'policies.txt' });
    });

    it("uses the agent's configured chunking strategy", async () => {
      mockPrisma.agent.findUnique.mockResolvedValue({
        aiConfig: { ragChunkingStrategy: 'markdown' },
      });
      await service.uploadFile(agentId, makeFile(), clientUser);
      expect(mockPrisma.agentDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ chunkingStrategy: 'markdown' }),
        }),
      );
    });

    it('enforces the per-agent document cap', async () => {
      mockPrisma.agentDocument.count.mockResolvedValue(25);
      await expect(
        service.uploadFile(agentId, makeFile(), clientUser),
      ).rejects.toThrow(/limit/i);
      expect(mockPrisma.agentDocument.create).not.toHaveBeenCalled();
    });

    it('rejects unsupported file types', async () => {
      const file = makeFile({
        originalname: 'virus.exe',
        mimetype: 'application/x-msdownload',
      });
      await expect(
        service.uploadFile(agentId, file, clientUser),
      ).rejects.toThrow(UnsupportedMediaTypeException);
    });

    it('rejects files that extract to empty text', async () => {
      const file = makeFile({ buffer: Buffer.from('   ') });
      await expect(
        service.uploadFile(agentId, file, clientUser),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('ingestUrl()', () => {
    it('fetches the page and creates a URL document', async () => {
      mockUrlFetcher.fetchPage.mockResolvedValue({
        text: 'Page content about pricing.',
        title: 'Pricing — Acme',
        contentType: 'text/html',
      });
      const doc = await service.ingestUrl(
        agentId,
        { url: 'https://acme.com/pricing' },
        clientUser,
      );
      expect(mockUrlFetcher.fetchPage).toHaveBeenCalledWith(
        'https://acme.com/pricing',
      );
      expect(mockPrisma.agentDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceType: 'URL',
            sourceUrl: 'https://acme.com/pricing',
            name: 'Pricing — Acme',
          }),
        }),
      );
      expect(mockIngestion.enqueue).toHaveBeenCalled();
      expect(doc).toBeDefined();
    });

    it('prefers the caller-supplied name over the page title', async () => {
      mockUrlFetcher.fetchPage.mockResolvedValue({
        text: 'content',
        title: 'Ignored title',
        contentType: 'text/html',
      });
      await service.ingestUrl(
        agentId,
        { url: 'https://acme.com/pricing', name: 'Custom name' },
        clientUser,
      );
      expect(mockPrisma.agentDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Custom name' }),
        }),
      );
    });
  });

  describe('reindex()', () => {
    it('re-fetches URL documents and re-queues with the current strategy', async () => {
      mockPrisma.agent.findUnique.mockResolvedValue({
        aiConfig: { ragChunkingStrategy: 'fixed' },
      });
      mockPrisma.agentDocument.findFirst.mockResolvedValue({
        id: 'doc-uuid',
        agentId,
        name: 'Pricing',
        status: 'READY',
        sourceType: 'URL',
        sourceUrl: 'https://acme.com/pricing',
        rawText: 'old text',
      });
      mockUrlFetcher.fetchPage.mockResolvedValue({
        text: 'fresh text',
        title: 'Pricing',
        contentType: 'text/html',
      });
      mockPrisma.agentDocument.update.mockResolvedValue({
        id: 'doc-uuid',
        chunkingStrategy: 'fixed',
      });

      await service.reindex(agentId, 'doc-uuid', clientUser);

      expect(mockPrisma.agentDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'PENDING',
            rawText: 'fresh text',
            chunkingStrategy: 'fixed',
          }),
        }),
      );
      expect(mockIngestion.enqueue).toHaveBeenCalledWith('doc-uuid');
    });

    it('rejects re-index while already processing', async () => {
      mockPrisma.agentDocument.findFirst.mockResolvedValue({
        id: 'doc-uuid',
        status: 'PROCESSING',
        sourceType: 'FILE',
        rawText: 'text',
      });
      await expect(
        service.reindex(agentId, 'doc-uuid', clientUser),
      ).rejects.toThrow(/already being processed/i);
    });

    it('404s for a document on a different agent', async () => {
      mockPrisma.agentDocument.findFirst.mockResolvedValue(null);
      await expect(
        service.reindex(agentId, 'doc-uuid', clientUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove()', () => {
    it('deletes the document (chunks cascade in the DB)', async () => {
      mockPrisma.agentDocument.findFirst.mockResolvedValue({
        id: 'doc-uuid',
        name: 'policies.txt',
      });
      mockPrisma.agentDocument.delete.mockResolvedValue({});
      await service.remove(agentId, 'doc-uuid', clientUser);
      expect(mockPrisma.agentDocument.delete).toHaveBeenCalledWith({
        where: { id: 'doc-uuid' },
      });
    });

    it('404s for missing documents', async () => {
      mockPrisma.agentDocument.findFirst.mockResolvedValue(null);
      await expect(
        service.remove(agentId, 'doc-uuid', clientUser),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
