import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Role, AccessScope } from '@prisma/client';
import { AgentKnowledgeService } from '../../../src/services/agent-knowledge.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { AgentCacheService } from '../../../src/common/cache/agent-cache.service';
import { TokenCounterService } from '../../../src/modules/ai/token-counter.service';
import { TracerService } from '../../../src/common/tracer/tracer.service';
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
  const mockTracer = { logAuditEvent: jest.fn() };

  const agentId = 'agent-uuid';
  const adminUser = {
    id: 'u1',
    role: Role.ADMIN,

    accessScope: AccessScope.PLATFORM,

    roleKeys: ['platform.support', 'platform.ops', 'platform.privacy', 'platform.agent_admin'],
    organizationId: 'org1',
  } as CurrentUserData;
  const clientUser = {
    id: 'u2',
    role: Role.CLIENT,

    accessScope: AccessScope.ORG,

    roleKeys: ['org.owner'],
    organizationId: 'org2',
  } as CurrentUserData;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentKnowledgeService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AgentCacheService, useValue: mockCache },
        { provide: TokenCounterService, useValue: mockTokenCounter },
        { provide: TracerService, useValue: mockTracer },
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

  describe('get()', () => {
    beforeEach(() => {
      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentId,
        organizationId: 'org1',
      });
    });

    it('returns the knowledge record when present', async () => {
      mockPrisma.agentKnowledge.findUnique.mockResolvedValue({
        agentId,
        content: 'kb',
      });
      const result = await service.get(agentId, adminUser);
      expect(result).toMatchObject({ content: 'kb' });
      expect(mockPrisma.agentKnowledge.findUnique).toHaveBeenCalledWith({
        where: { agentId },
      });
    });

    it('returns null when no knowledge record exists', async () => {
      mockPrisma.agentKnowledge.findUnique.mockResolvedValue(null);
      expect(await service.get(agentId, adminUser)).toBeNull();
    });

    it('scopes CLIENT users to their own organisation', async () => {
      mockPrisma.agentKnowledge.findUnique.mockResolvedValue(null);
      await service.get(agentId, clientUser);
      expect(mockPrisma.agent.findFirst).toHaveBeenCalledWith({
        where: { id: agentId, deletedAt: null, organizationId: 'org2' },
        select: { id: true, organizationId: true },
      });
    });

    it('rejects a cross-tenant CLIENT with NotFound and never reads knowledge', async () => {
      // Foreign agent: the org-scoped lookup returns nothing.
      mockPrisma.agent.findFirst.mockResolvedValue(null);
      await expect(service.get(agentId, clientUser)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.agentKnowledge.findUnique).not.toHaveBeenCalled();
    });

    it('does NOT org-scope ADMIN users', async () => {
      mockPrisma.agentKnowledge.findUnique.mockResolvedValue(null);
      await service.get(agentId, adminUser);
      expect(mockPrisma.agent.findFirst).toHaveBeenCalledWith({
        where: { id: agentId, deletedAt: null },
        select: { id: true, organizationId: true },
      });
    });
  });

  describe('set()', () => {
    beforeEach(() => {
      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentId,
        organizationId: 'org1',
      });
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
        adminUser,
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
      expect(mockTracer.logAuditEvent).toHaveBeenCalledWith(
        agentId,
        'AGENT_KNOWLEDGE_UPDATED',
        expect.anything(),
        { agentId },
      );
    });

    it('defaults sourceFileName + sourceMimeType to null when omitted', async () => {
      await service.set(agentId, { content: 'Hi' }, adminUser);
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
        service.set(agentId, { content: huge }, adminUser),
      ).rejects.toThrow(PayloadTooLargeException);
      expect(mockPrisma.agentKnowledge.upsert).not.toHaveBeenCalled();
    });

    it('throws NotFound when agent does not exist or is soft-deleted', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);
      await expect(
        service.set(agentId, { content: 'x' }, adminUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a cross-tenant CLIENT with NotFound and never writes', async () => {
      // Foreign agent: the org-scoped lookup returns nothing → no upsert.
      mockPrisma.agent.findFirst.mockResolvedValue(null);
      await expect(
        service.set(agentId, { content: 'poison' }, clientUser),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.agent.findFirst).toHaveBeenCalledWith({
        where: { id: agentId, deletedAt: null, organizationId: 'org2' },
        select: { id: true, organizationId: true },
      });
      expect(mockPrisma.agentKnowledge.upsert).not.toHaveBeenCalled();
    });
  });

  describe('extractFile()', () => {
    beforeEach(() => {
      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentId,
        organizationId: 'org1',
      });
      mockTokenCounter.countTokens.mockReturnValue(3);
    });

    it('extracts plain text and returns metadata', async () => {
      const file = makeFile({
        originalname: 'kb.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('Hello world'),
        size: 11,
      });
      const result = await service.extractFile(agentId, file, adminUser);
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
      const result = await service.extractFile(agentId, file, adminUser);
      expect(result.content).toBe('# heading');
    });

    it('falls back to extension when MIME is generic', async () => {
      const file = makeFile({
        originalname: 'notes.md',
        mimetype: 'application/octet-stream',
        buffer: Buffer.from('plain'),
        size: 5,
      });
      const result = await service.extractFile(agentId, file, adminUser);
      expect(result.content).toBe('plain');
    });

    it('rejects empty extracted text', async () => {
      const file = makeFile({
        originalname: 'kb.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('   \n\t  '),
        size: 7,
      });
      await expect(service.extractFile(agentId, file, adminUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects files over the upload byte limit', async () => {
      const file = makeFile({
        originalname: 'kb.txt',
        mimetype: 'text/plain',
        size: 100 * 1024 * 1024, // 100 MB
        buffer: Buffer.from('x'),
      });
      await expect(service.extractFile(agentId, file, adminUser)).rejects.toThrow(
        PayloadTooLargeException,
      );
    });

    it('rejects unsupported file types with helpful .doc message', async () => {
      const file = makeFile({
        originalname: 'old.doc',
        mimetype: 'application/msword',
        size: 50,
        buffer: Buffer.from('xxx'),
      });
      await expect(service.extractFile(agentId, file, adminUser)).rejects.toThrow(
        UnsupportedMediaTypeException,
      );
      await expect(service.extractFile(agentId, file, adminUser)).rejects.toThrow(
        /\.doc/i,
      );
    });

    it('rejects unsupported file types with generic message', async () => {
      const file = makeFile({
        originalname: 'data.xyz',
        mimetype: 'application/x-weird',
        size: 50,
        buffer: Buffer.from('xxx'),
      });
      await expect(service.extractFile(agentId, file, adminUser)).rejects.toThrow(
        UnsupportedMediaTypeException,
      );
    });

    it('throws NotFound when agent does not exist', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);
      const file = makeFile();
      await expect(service.extractFile(agentId, file, adminUser)).rejects.toThrow(
        NotFoundException,
      );
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
      await expect(service.extractFile(agentId, file, adminUser)).rejects.toThrow(
        PayloadTooLargeException,
      );
    });
  });

  describe('remove()', () => {
    beforeEach(() => {
      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentId,
        organizationId: 'org1',
      });
    });

    it('deletes the record and invalidates cache', async () => {
      mockPrisma.agentKnowledge.delete.mockResolvedValue({ agentId });
      await service.remove(agentId, adminUser);
      expect(mockPrisma.agentKnowledge.delete).toHaveBeenCalledWith({
        where: { agentId },
      });
      expect(mockCache.invalidate).toHaveBeenCalledWith(agentId);
      expect(mockTracer.logAuditEvent).toHaveBeenCalledWith(
        agentId,
        'AGENT_KNOWLEDGE_DELETED',
        expect.anything(),
        { agentId },
      );
    });

    it('is idempotent — swallows missing-record errors', async () => {
      mockPrisma.agentKnowledge.delete.mockRejectedValue(new Error('not found'));
      await expect(service.remove(agentId, adminUser)).resolves.toBeUndefined();
      expect(mockCache.invalidate).toHaveBeenCalledWith(agentId);
    });

    it('rejects a cross-tenant CLIENT with NotFound and never deletes', async () => {
      // Foreign agent: the org-scoped lookup returns nothing → no delete.
      mockPrisma.agent.findFirst.mockResolvedValue(null);
      await expect(service.remove(agentId, clientUser)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.agent.findFirst).toHaveBeenCalledWith({
        where: { id: agentId, deletedAt: null, organizationId: 'org2' },
        select: { id: true, organizationId: true },
      });
      expect(mockPrisma.agentKnowledge.delete).not.toHaveBeenCalled();
    });
  });
});
