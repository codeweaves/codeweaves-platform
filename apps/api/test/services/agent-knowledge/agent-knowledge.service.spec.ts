import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { AgentKnowledgeService } from '../../../src/services/agent-knowledge.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { AgentCacheService } from '../../../src/common/cache/agent-cache.service';
import { TokenCounterService } from '../../../src/modules/ai/token-counter.service';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('AgentKnowledgeService', () => {
  let service: AgentKnowledgeService;

  const mockPrisma = {
    agent: { findFirst: jest.fn() },
    agentKnowledge: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
  };
  const mockCache = { invalidate: jest.fn() };
  const mockTokenCounter = { countTokens: jest.fn() };

  const agentId = 'agent-uuid';
  const orgId = 'org-uuid';

  const clientUser = {
    clerkId: 'clerk_1',
    email: 'client@org.com',
    id: 'user-uuid',
    role: Role.CLIENT,
    organizationId: orgId,
    organization: null,
  } as unknown as CurrentUserData;

  const adminUser = {
    ...clientUser,
    role: Role.ADMIN,
    organizationId: null,
  } as unknown as CurrentUserData;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: the agent exists and belongs to the caller's org.
    mockPrisma.agent.findFirst.mockResolvedValue({
      id: agentId,
      organizationId: orgId,
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentKnowledgeService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AgentCacheService, useValue: mockCache },
        { provide: TokenCounterService, useValue: mockTokenCounter },
      ],
    }).compile();
    service = moduleRef.get(AgentKnowledgeService);
  });

  const makeFile = (
    overrides: Partial<Express.Multer.File> = {},
  ): Express.Multer.File => ({
    fieldname: 'file',
    originalname: 'doc.txt',
    encoding: '7bit',
    mimetype: 'text/plain',
    size: 100,
    buffer: Buffer.from('Hello world'),
    destination: '',
    filename: '',
    path: '',
    stream: undefined as never,
    ...overrides,
  });

  describe('tenant isolation (IDOR regression)', () => {
    it('scopes the agent lookup by organizationId for CLIENT users', async () => {
      mockPrisma.agentKnowledge.findUnique.mockResolvedValue(null);
      await service.get(agentId, clientUser);
      expect(mockPrisma.agent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: agentId,
            deletedAt: null,
            organizationId: orgId,
          }),
        }),
      );
    });

    it('does NOT restrict org for ADMIN users (platform staff)', async () => {
      mockPrisma.agentKnowledge.findUnique.mockResolvedValue(null);
      await service.get(agentId, adminUser);
      const where = mockPrisma.agent.findFirst.mock.calls[0][0].where;
      expect(where).not.toHaveProperty('organizationId');
    });

    it("404s when a CLIENT requests another org's agent knowledge", async () => {
      // The org-scoped lookup finds nothing → NotFound, and the knowledge
      // table is never touched.
      mockPrisma.agent.findFirst.mockResolvedValue(null);
      await expect(service.get(agentId, clientUser)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.agentKnowledge.findUnique).not.toHaveBeenCalled();
    });

    it("404s on cross-tenant set()", async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);
      await expect(
        service.set(agentId, { content: 'x' }, clientUser),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.agentKnowledge.upsert).not.toHaveBeenCalled();
    });

    it("404s on cross-tenant remove()", async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);
      await expect(service.remove(agentId, clientUser)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.agentKnowledge.delete).not.toHaveBeenCalled();
    });

    it('404s for a CLIENT with no organization at all', async () => {
      const orphanClient = {
        ...clientUser,
        organizationId: null,
      } as unknown as CurrentUserData;
      await expect(service.get(agentId, orphanClient)).rejects.toThrow(
        NotFoundException,
      );
      // Short-circuits before any DB access.
      expect(mockPrisma.agent.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('get()', () => {
    it('returns the knowledge record when present', async () => {
      mockPrisma.agentKnowledge.findUnique.mockResolvedValue({
        agentId,
        content: 'kb',
      });
      const result = await service.get(agentId, clientUser);
      expect(result).toMatchObject({ content: 'kb' });
      expect(mockPrisma.agentKnowledge.findUnique).toHaveBeenCalledWith({
        where: { agentId },
      });
    });

    it('returns null when no knowledge record exists', async () => {
      mockPrisma.agentKnowledge.findUnique.mockResolvedValue(null);
      expect(await service.get(agentId, clientUser)).toBeNull();
    });
  });

  describe('set()', () => {
    beforeEach(() => {
      mockTokenCounter.countTokens.mockReturnValue(42);
      mockPrisma.agentKnowledge.upsert.mockResolvedValue({
        agentId,
        content: 'Hello',
      });
    });

    it('upserts content + invalidates cache', async () => {
      const result = await service.set(
        agentId,
        {
          content: 'Hello',
          sourceFileName: 'kb.txt',
          sourceMimeType: 'text/plain',
        },
        clientUser,
      );
      expect(mockPrisma.agentKnowledge.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { agentId },
          create: expect.objectContaining({
            content: 'Hello',
            contentTokens: 42,
            sourceFileName: 'kb.txt',
            sourceMimeType: 'text/plain',
          }),
          update: expect.objectContaining({
            content: 'Hello',
            sourceSizeBytes: null,
          }),
        }),
      );
      expect(mockCache.invalidate).toHaveBeenCalledWith(agentId);
      expect(result).toMatchObject({ content: 'Hello' });
    });

    it('defaults sourceFileName + sourceMimeType to null when omitted', async () => {
      await service.set(agentId, { content: 'Hi' }, clientUser);
      expect(mockPrisma.agentKnowledge.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            sourceFileName: null,
            sourceMimeType: null,
          }),
        }),
      );
    });

    it('rejects content over the byte limit', async () => {
      // 1 MB > MAX_KNOWLEDGE_TEXT_BYTES (currently 512KB-ish).
      const huge = 'a'.repeat(2 * 1024 * 1024);
      await expect(
        service.set(agentId, { content: huge }, clientUser),
      ).rejects.toThrow(PayloadTooLargeException);
      expect(mockPrisma.agentKnowledge.upsert).not.toHaveBeenCalled();
    });

    it('throws NotFound when agent does not exist or is soft-deleted', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);
      await expect(
        service.set(agentId, { content: 'x' }, clientUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('extractFile()', () => {
    beforeEach(() => {
      mockTokenCounter.countTokens.mockReturnValue(3);
    });

    it('extracts plain text and returns metadata', async () => {
      const file = makeFile({
        originalname: 'kb.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('Hello world'),
        size: 11,
      });
      const result = await service.extractFile(agentId, file, clientUser);
      expect(result).toEqual({
        content: 'Hello world',
        contentTokens: 3,
        sourceFileName: 'kb.txt',
        sourceMimeType: 'text/plain',
        sourceSizeBytes: 11,
      });
      // No DB writes during extract.
      expect(mockPrisma.agentKnowledge.upsert).not.toHaveBeenCalled();
      expect(mockCache.invalidate).not.toHaveBeenCalled();
    });

    it('extracts markdown via the text path', async () => {
      const file = makeFile({
        originalname: 'kb.md',
        mimetype: 'text/markdown',
        buffer: Buffer.from('# heading'),
        size: 9,
      });
      const result = await service.extractFile(agentId, file, clientUser);
      expect(result.content).toBe('# heading');
    });

    it('falls back to extension when MIME is generic', async () => {
      const file = makeFile({
        originalname: 'notes.md',
        mimetype: 'application/octet-stream',
        buffer: Buffer.from('plain'),
        size: 5,
      });
      const result = await service.extractFile(agentId, file, clientUser);
      expect(result.content).toBe('plain');
    });

    it('rejects empty extracted text', async () => {
      const file = makeFile({
        originalname: 'kb.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('   \n\t  '),
        size: 7,
      });
      await expect(
        service.extractFile(agentId, file, clientUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects files over the upload byte limit', async () => {
      const file = makeFile({
        originalname: 'kb.txt',
        mimetype: 'text/plain',
        size: 100 * 1024 * 1024, // 100 MB
        buffer: Buffer.from('x'),
      });
      await expect(
        service.extractFile(agentId, file, clientUser),
      ).rejects.toThrow(PayloadTooLargeException);
    });

    it('rejects unsupported file types with helpful .doc message', async () => {
      const file = makeFile({
        originalname: 'old.doc',
        mimetype: 'application/msword',
        size: 50,
        buffer: Buffer.from('xxx'),
      });
      await expect(
        service.extractFile(agentId, file, clientUser),
      ).rejects.toThrow(UnsupportedMediaTypeException);
      await expect(
        service.extractFile(agentId, file, clientUser),
      ).rejects.toThrow(/\.doc/i);
    });

    it('rejects unsupported file types with generic message', async () => {
      const file = makeFile({
        originalname: 'data.xyz',
        mimetype: 'application/x-weird',
        size: 50,
        buffer: Buffer.from('xxx'),
      });
      await expect(
        service.extractFile(agentId, file, clientUser),
      ).rejects.toThrow(UnsupportedMediaTypeException);
    });

    it('throws NotFound when agent does not exist', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);
      const file = makeFile();
      await expect(
        service.extractFile(agentId, file, clientUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects extracted text over the byte limit', async () => {
      const huge = 'a'.repeat(2 * 1024 * 1024);
      const file = makeFile({
        originalname: 'big.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from(huge),
        size: huge.length,
      });
      // Caller-side file size check fires first only if size > upload limit.
      // Here size < upload limit but extracted text > text limit.
      mockTokenCounter.countTokens.mockReturnValue(huge.length);
      await expect(
        service.extractFile(agentId, file, clientUser),
      ).rejects.toThrow(PayloadTooLargeException);
    });
  });

  describe('remove()', () => {
    it('deletes the record and invalidates cache', async () => {
      mockPrisma.agentKnowledge.delete.mockResolvedValue({ agentId });
      await service.remove(agentId, clientUser);
      expect(mockPrisma.agentKnowledge.delete).toHaveBeenCalledWith({
        where: { agentId },
      });
      expect(mockCache.invalidate).toHaveBeenCalledWith(agentId);
    });

    it('is idempotent — swallows missing-record errors', async () => {
      mockPrisma.agentKnowledge.delete.mockRejectedValue(new Error('not found'));
      await expect(service.remove(agentId, clientUser)).resolves.toBeUndefined();
      expect(mockCache.invalidate).toHaveBeenCalledWith(agentId);
    });
  });
});
