import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AccessScope, Role } from '@prisma/client';
import { PrivacyController } from '../../../src/controllers/privacy/privacy.controller';
import { PurgeService } from '../../../src/services/purge.service';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('PrivacyController', () => {
  let controller: PrivacyController;

  const mockPurge = {
    eraseVisitor: jest.fn(),
    eraseOrganization: jest.fn(),
    summarizeVisitor: jest.fn(),
  };

  const admin = {
    id: 'u2',
    role: Role.ADMIN,
    accessScope: AccessScope.PLATFORM,
    roleKeys: ['platform.privacy'],
    organizationId: 'platform-org',
  } as CurrentUserData;
  const client = {
    id: 'u3',
    role: Role.CLIENT,
    accessScope: AccessScope.ORG,
    roleKeys: ['org.owner'],
    organizationId: 'client-org',
  } as CurrentUserData;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPurge.eraseVisitor.mockResolvedValue({ sessions: 1 });
    mockPurge.eraseOrganization.mockResolvedValue({ agents: 1 });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PrivacyController],
      providers: [
        { provide: PurgeService, useValue: mockPurge },
      ],
    }).compile();

    controller = module.get(PrivacyController);
  });

  describe('eraseVisitor', () => {
    it('pins CLIENT users to their own organization, ignoring any passed orgId', async () => {
      await controller.eraseVisitor('vh_abc', client, 'someone-elses-org');
      expect(mockPurge.eraseVisitor).toHaveBeenCalledWith('client-org', 'vh_abc');
    });

    it('lets ADMIN target an org explicitly', async () => {
      await controller.eraseVisitor('vh_abc', admin, 'target-org');
      expect(mockPurge.eraseVisitor).toHaveBeenCalledWith('target-org', 'vh_abc');
    });

    it('falls back to the admin\'s own org when none passed', async () => {
      await controller.eraseVisitor('vh_abc', admin, undefined);
      expect(mockPurge.eraseVisitor).toHaveBeenCalledWith('platform-org', 'vh_abc');
    });

    it('rejects when no org scope can be resolved', async () => {
      const orphanAdmin = { id: 'u4', role: Role.ADMIN, organizationId: null } as unknown as CurrentUserData;
      await expect(
        controller.eraseVisitor('vh_abc', orphanAdmin, undefined),
      ).rejects.toThrow(BadRequestException);
      expect(mockPurge.eraseVisitor).not.toHaveBeenCalled();
    });
  });

  describe('summarizeVisitor', () => {
    it('pins CLIENT users to their own organization', async () => {
      mockPurge.summarizeVisitor.mockResolvedValue({ sessions: [] });
      await controller.summarizeVisitor('vh_abc', client, 'someone-elses-org');
      expect(mockPurge.summarizeVisitor).toHaveBeenCalledWith('client-org', 'vh_abc');
    });

    it('lets ADMIN target an org explicitly', async () => {
      mockPurge.summarizeVisitor.mockResolvedValue({ sessions: [] });
      await controller.summarizeVisitor('vh_abc', admin, 'target-org');
      expect(mockPurge.summarizeVisitor).toHaveBeenCalledWith('target-org', 'vh_abc');
    });
  });

  describe('eraseOrganization', () => {
    const ORG = 'b7e6a1c2-3d4f-5a6b-7c8d-9e0f1a2b3c4d';

    it('requires the confirm param to exactly repeat the org id', async () => {
      await expect(
        controller.eraseOrganization(ORG, undefined),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        controller.eraseOrganization(ORG, 'wrong-value'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPurge.eraseOrganization).not.toHaveBeenCalled();
    });

    it('erases when confirmation matches', async () => {
      await controller.eraseOrganization(ORG, ORG);
      expect(mockPurge.eraseOrganization).toHaveBeenCalledWith(ORG);
    });
  });
});
