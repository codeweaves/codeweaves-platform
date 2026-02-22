import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { AgentFilesController } from '../../../src/controllers/agents/agent-files.controller';
import { FilesService } from '../../../src/services/files.service';
import { RolesGuard } from '../../../src/guards/roles.guard';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('AgentFilesController', () => {
  let controller: AgentFilesController;

  const mockFilesService = {
    uploadAgentAsset: jest.fn(),
    deleteFile: jest.fn(),
  };

  const orgId = '123e4567-e89b-12d3-a456-426614174000';
  const agentId = '333e4567-e89b-12d3-a456-426614174000';
  const fileId = '555e4567-e89b-12d3-a456-426614174000';

  const adminUser: CurrentUserData = {
    auth0Id: 'auth0|admin',
    email: 'admin@test.com',
    roles: ['ADMIN'],
    id: 'admin-user-id',
    role: Role.ADMIN,
    organizationId: orgId,
    organization: { id: orgId, name: 'Test Org', slug: 'test-org' },
  };

  const mockFile = {
    fieldname: 'file',
    originalname: 'test.png',
    mimetype: 'image/png',
    buffer: Buffer.from('test'),
    size: 100,
  } as Express.Multer.File;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentFilesController],
      providers: [
        { provide: FilesService, useValue: mockFilesService },
        Reflector,
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AgentFilesController>(AgentFilesController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /agents/:id/files/upload', () => {
    it('should upload file and return result', async () => {
      const uploadResult = {
        id: fileId,
        publicUrl: 'https://storage.example.com/file.png',
        fileName: 'test.png',
        purpose: 'header-logo',
      };
      mockFilesService.uploadAgentAsset.mockResolvedValue(uploadResult);

      const result = await controller.uploadFile(
        agentId,
        mockFile,
        'header-logo',
        adminUser,
      );

      expect(result).toEqual(uploadResult);
      expect(mockFilesService.uploadAgentAsset).toHaveBeenCalledWith(mockFile, {
        agentId,
        purpose: 'header-logo',
        user: adminUser,
      });
    });

    it('should throw BadRequestException when purpose is missing', async () => {
      await expect(
        controller.uploadFile(agentId, mockFile, '', adminUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('should propagate NotFoundException from service', async () => {
      mockFilesService.uploadAgentAsset.mockRejectedValue(
        new NotFoundException('Agent not found'),
      );

      await expect(
        controller.uploadFile(agentId, mockFile, 'header-logo', adminUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('DELETE /agents/:id/files/:fileId', () => {
    it('should delete file and return success', async () => {
      mockFilesService.deleteFile.mockResolvedValue(undefined);

      const result = await controller.deleteFile(agentId, fileId, adminUser);

      expect(result).toEqual({ success: true });
      expect(mockFilesService.deleteFile).toHaveBeenCalledWith(
        fileId,
        agentId,
        adminUser,
      );
    });

    it('should propagate NotFoundException from service', async () => {
      mockFilesService.deleteFile.mockRejectedValue(
        new NotFoundException('File not found'),
      );

      await expect(
        controller.deleteFile(agentId, fileId, adminUser),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
