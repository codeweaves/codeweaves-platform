import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createClerkClient } from '@clerk/backend';

jest.mock('@clerk/backend', () => ({
  createClerkClient: jest.fn(),
}));

import { ClerkManagementService } from '../../../src/services/clerk-management.service';
import { ClerkLoggerService } from '../../../src/common/logger/clerk.logger';
import { ProviderEventLogger } from '../../../src/common/events/provider.logger';

const mockClerkClient = {
  invitations: {
    createInvitation: jest.fn(),
    revokeInvitation: jest.fn(),
  },
};

describe('ClerkManagementService', () => {
  let service: ClerkManagementService;

  const mockClerkLogger = {
    logClerkInvitationCreated: jest.fn(),
    logClerkInvitationCreationFailed: jest.fn(),
    logClerkInvitationRevoked: jest.fn(),
    logClerkInvitationRevocationFailed: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    (createClerkClient as jest.Mock).mockReturnValue(mockClerkClient);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClerkManagementService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => 'sk_test_secret') },
        },
        { provide: ClerkLoggerService, useValue: mockClerkLogger },
        { provide: ProviderEventLogger, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = module.get<ClerkManagementService>(ClerkManagementService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createInvitation', () => {
    it('should create an invitation (notify:false) and return id + url', async () => {
      mockClerkClient.invitations.createInvitation.mockResolvedValue({
        id: 'clerk_inv_1',
        url: 'https://accounts.klivo.app/accept?__clerk_ticket=t',
      });

      const result = await service.createInvitation({
        email: 'new@example.com',
        redirectUrl: 'https://klivo.app/sign-up',
        expiresInDays: 7,
      });

      expect(result).toEqual({
        id: 'clerk_inv_1',
        url: 'https://accounts.klivo.app/accept?__clerk_ticket=t',
      });
      expect(mockClerkClient.invitations.createInvitation).toHaveBeenCalledWith({
        emailAddress: 'new@example.com',
        redirectUrl: 'https://klivo.app/sign-up',
        expiresInDays: 7,
        notify: false,
        ignoreExisting: true,
      });
      expect(mockClerkLogger.logClerkInvitationCreated).toHaveBeenCalled();
    });

    it('should normalize a missing url to null', async () => {
      mockClerkClient.invitations.createInvitation.mockResolvedValue({
        id: 'clerk_inv_2',
        url: undefined,
      });

      const result = await service.createInvitation({
        email: 'x@example.com',
        redirectUrl: 'https://klivo.app/sign-up',
        expiresInDays: 7,
      });

      expect(result).toEqual({ id: 'clerk_inv_2', url: null });
    });

    it('should log and rethrow on failure', async () => {
      mockClerkClient.invitations.createInvitation.mockRejectedValue(
        new Error('Clerk down'),
      );

      await expect(
        service.createInvitation({
          email: 'x@example.com',
          redirectUrl: 'https://klivo.app/sign-up',
          expiresInDays: 7,
        }),
      ).rejects.toThrow('Clerk down');
      expect(mockClerkLogger.logClerkInvitationCreationFailed).toHaveBeenCalled();
    });
  });

  describe('revokeInvitation', () => {
    it('should revoke an invitation by id', async () => {
      mockClerkClient.invitations.revokeInvitation.mockResolvedValue({});

      await service.revokeInvitation('clerk_inv_1');

      expect(mockClerkClient.invitations.revokeInvitation).toHaveBeenCalledWith(
        'clerk_inv_1',
      );
      expect(mockClerkLogger.logClerkInvitationRevoked).toHaveBeenCalled();
    });

    it('should treat a 404 as success (idempotent)', async () => {
      mockClerkClient.invitations.revokeInvitation.mockRejectedValue({
        status: 404,
      });

      await expect(
        service.revokeInvitation('missing'),
      ).resolves.toBeUndefined();
      expect(
        mockClerkLogger.logClerkInvitationRevocationFailed,
      ).not.toHaveBeenCalled();
    });

    it('should log and rethrow non-404 errors', async () => {
      mockClerkClient.invitations.revokeInvitation.mockRejectedValue({
        status: 500,
        message: 'server error',
      });

      await expect(service.revokeInvitation('x')).rejects.toBeDefined();
      expect(
        mockClerkLogger.logClerkInvitationRevocationFailed,
      ).toHaveBeenCalled();
    });
  });
});
