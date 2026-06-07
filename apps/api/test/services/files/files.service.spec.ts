import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { FilesService } from '../../../src/services/files.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { SupabaseStorageService } from '../../../src/services/supabase-storage.service';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('FilesService', () => {
  let service: FilesService;

  const mockPrismaService = {
    agent: { findFirst: jest.fn() },
    agentTheme: { findUnique: jest.fn() },
    file: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockStorageService = {
    upload: jest.fn(),
    remove: jest.fn(),
    getPublicUrl: jest.fn(),
  };

  const orgId = '123e4567-e89b-12d3-a456-426614174000';
  const agentId = '333e4567-e89b-12d3-a456-426614174000';
  const themeId = '444e4567-e89b-12d3-a456-426614174000';
  const fileId = '555e4567-e89b-12d3-a456-426614174000';

  const mockAgent = {
    id: agentId,
    organizationId: orgId,
    deletedAt: null,
  };

  const adminUser: CurrentUserData = {
    clerkId: 'user_admin',
    email: 'admin@test.com',
    id: 'admin-user-id',
    role: Role.ADMIN,
    organizationId: orgId,
    organization: { id: orgId, name: 'Test Org', slug: 'test-org' },
  };

  const clientUser: CurrentUserData = {
    clerkId: 'user_client',
    email: 'client@test.com',
    id: 'client-user-id',
    role: Role.CLIENT,
    organizationId: orgId,
    organization: { id: orgId, name: 'Test Org', slug: 'test-org' },
  };

  const mockFile: Express.Multer.File = {
    fieldname: 'file',
    originalname: 'test-image.png',
    encoding: '7bit',
    mimetype: 'image/png',
    buffer: Buffer.from('fake-image-data'),
    size: 1024,
    stream: null as unknown as import('stream').Readable,
    destination: '',
    filename: '',
    path: '',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: SupabaseStorageService, useValue: mockStorageService },
      ],
    }).compile();

    service = module.get<FilesService>(FilesService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadAgentAsset', () => {
    it('should upload file and create record', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({ id: themeId });
      mockPrismaService.file.findFirst.mockResolvedValue(null); // no previous file
      mockStorageService.upload.mockResolvedValue('https://storage.example.com/file.png');
      mockPrismaService.file.create.mockResolvedValue({
        id: fileId,
        publicUrl: 'https://storage.example.com/file.png',
        fileName: 'test-image.png',
        purpose: 'header-logo',
      });

      const result = await service.uploadAgentAsset(mockFile, {
        agentId,
        purpose: 'header-logo',
        user: adminUser,
      });

      expect(result).toEqual({
        id: fileId,
        publicUrl: 'https://storage.example.com/file.png',
        fileName: 'test-image.png',
        purpose: 'header-logo',
      });
      expect(mockStorageService.upload).toHaveBeenCalledWith(
        'agent-assets',
        expect.stringContaining(`${orgId}/${agentId}/header-logo/`),
        mockFile.buffer,
        'image/png',
      );
      expect(mockPrismaService.file.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fileName: 'test-image.png',
          mimeType: 'image/png',
          sizeBytes: 1024,
          entityType: 'agent-theme',
          entityId: themeId,
          purpose: 'header-logo',
          organizationId: orgId,
          uploadedById: adminUser.id,
        }),
      });
    });

    it('should replace previous file with same purpose', async () => {
      const existingFile = {
        id: 'old-file-id',
        bucket: 'agent-assets',
        storageKey: 'old/path/file.png',
      };

      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({ id: themeId });
      mockPrismaService.file.findFirst.mockResolvedValue(existingFile);
      mockStorageService.upload.mockResolvedValue('https://storage.example.com/new-file.png');
      mockPrismaService.file.create.mockResolvedValue({
        id: fileId,
        publicUrl: 'https://storage.example.com/new-file.png',
        fileName: 'test-image.png',
        purpose: 'header-logo',
      });

      await service.uploadAgentAsset(mockFile, {
        agentId,
        purpose: 'header-logo',
        user: adminUser,
      });

      // Should delete previous file
      expect(mockStorageService.remove).toHaveBeenCalledWith('agent-assets', ['old/path/file.png']);
      expect(mockPrismaService.file.delete).toHaveBeenCalledWith({
        where: { id: 'old-file-id' },
      });
    });

    it('should reject invalid purpose', async () => {
      await expect(
        service.uploadAgentAsset(mockFile, {
          agentId,
          purpose: 'invalid-purpose',
          user: adminUser,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject file exceeding 2MB', async () => {
      const largeFile = { ...mockFile, size: 3 * 1024 * 1024 };

      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);

      await expect(
        service.uploadAgentAsset(largeFile as Express.Multer.File, {
          agentId,
          purpose: 'header-logo',
          user: adminUser,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject unsupported mime type', async () => {
      const pdfFile = { ...mockFile, mimetype: 'application/pdf' };

      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);

      await expect(
        service.uploadAgentAsset(pdfFile as Express.Multer.File, {
          agentId,
          purpose: 'header-logo',
          user: adminUser,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when no file is provided', async () => {
      await expect(
        service.uploadAgentAsset(
          undefined as unknown as Express.Multer.File,
          { agentId, purpose: 'header-logo', user: adminUser },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when agent does not exist', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      await expect(
        service.uploadAgentAsset(mockFile, {
          agentId,
          purpose: 'header-logo',
          user: adminUser,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should scope CLIENT users to their org', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      await expect(
        service.uploadAgentAsset(mockFile, {
          agentId,
          purpose: 'header-logo',
          user: clientUser,
        }),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrismaService.agent.findFirst).toHaveBeenCalledWith({
        where: {
          id: agentId,
          deletedAt: null,
          organizationId: orgId,
        },
      });
    });

    it('should use agentId as entityId when no theme exists', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue(null);
      mockPrismaService.file.findFirst.mockResolvedValue(null);
      mockStorageService.upload.mockResolvedValue('https://storage.example.com/file.png');
      mockPrismaService.file.create.mockResolvedValue({
        id: fileId,
        publicUrl: 'https://storage.example.com/file.png',
        fileName: 'test-image.png',
        purpose: 'header-logo',
      });

      await service.uploadAgentAsset(mockFile, {
        agentId,
        purpose: 'header-logo',
        user: adminUser,
      });

      expect(mockPrismaService.file.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityId: agentId,
        }),
      });
    });
  });

  describe('deleteFile', () => {
    it('should delete file from storage and database', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.file.findUnique.mockResolvedValue({
        id: fileId,
        bucket: 'agent-assets',
        storageKey: 'path/to/file.png',
      });

      await service.deleteFile(fileId, agentId, adminUser);

      expect(mockStorageService.remove).toHaveBeenCalledWith('agent-assets', ['path/to/file.png']);
      expect(mockPrismaService.file.delete).toHaveBeenCalledWith({
        where: { id: fileId },
      });
    });

    it('should throw NotFoundException when file does not exist', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.file.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteFile(fileId, agentId, adminUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when agent does not exist', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteFile(fileId, agentId, adminUser),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
