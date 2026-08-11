import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AccessScope } from '@prisma/client';

import { WsAuthService } from '../../../src/common/ws/ws-auth.service';
import { PrismaService } from '../../../src/services/prisma.service';

// Mock the Clerk token verifier — the unit under test is the scope-resolution
// logic, not Clerk's crypto.
jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn(),
}));
import { verifyToken } from '@clerk/backend';

const mockVerifyToken = verifyToken as jest.Mock;

describe('WsAuthService', () => {
  let service: WsAuthService;

  const orgId = '123e4567-e89b-12d3-a456-426614174000';
  const sessionId = 'sess-abcdef-unguessable-uuid';

  const mockPrismaService = {
    user: { findFirst: jest.fn() },
  };

  const mockConfigService = {
    get: jest.fn((key: string, def?: string) =>
      key === 'CLERK_SECRET_KEY' ? 'sk_test_secret' : def,
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Set the config impl BEFORE compiling — the service reads CLERK_SECRET_KEY
    // in its constructor, and the jest config resets mock implementations
    // between tests. If we set it after compile, secretKey would be empty and
    // the token path would short-circuit.
    mockConfigService.get.mockImplementation((key: string, def?: string) =>
      key === 'CLERK_SECRET_KEY' ? 'sk_test_secret' : def,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WsAuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<WsAuthService>(WsAuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('widget (session bearer) path', () => {
    it('resolves a session-only scope from an unguessable sessionId — no token, no auth', async () => {
      const scope = await service.resolveScope({ auth: { sessionId } });

      expect(scope).toEqual({ sessionId });
      // Never touches the DB or the token verifier.
      expect(mockVerifyToken).not.toHaveBeenCalled();
      expect(mockPrismaService.user.findFirst).not.toHaveBeenCalled();
    });

    it('reads sessionId from the query string too', async () => {
      const scope = await service.resolveScope({ query: { sessionId } });
      expect(scope).toEqual({ sessionId });
    });
  });

  describe('dashboard (Clerk token) path', () => {
    it('scopes an ORG user to their OWN org from the DB, never from a client-supplied orgId', async () => {
      mockVerifyToken.mockResolvedValue({ sub: 'user_client' });
      mockPrismaService.user.findFirst.mockResolvedValue({
        accessScope: AccessScope.ORG,
        organizationId: orgId,
      });

      // Attacker also passes a foreign orgId in the handshake — it must be ignored.
      const scope = await service.resolveScope({
        auth: { token: 'good-token', orgId: 'some-other-org', platform: true },
      });

      expect(scope).toEqual({ orgId });
      expect(mockPrismaService.user.findFirst).toHaveBeenCalledWith({
        where: { clerkId: 'user_client', deletedAt: null },
        select: { accessScope: true, organizationId: true },
      });
    });

    it('gives a PLATFORM account (no org) the platform room', async () => {
      mockVerifyToken.mockResolvedValue({ sub: 'user_admin' });
      mockPrismaService.user.findFirst.mockResolvedValue({
        accessScope: AccessScope.PLATFORM,
        organizationId: null,
      });

      const scope = await service.resolveScope({ auth: { token: 'good-token' } });
      expect(scope).toEqual({ platform: true });
    });

    it('ignores the legacy role column when deciding the room', async () => {
      mockVerifyToken.mockResolvedValue({ sub: 'user_super' });
      mockPrismaService.user.findFirst.mockResolvedValue({
        // A demoted account keeps its old role but must NOT reach the all-orgs room.
        role: 'SUPER_ADMIN',
        accessScope: AccessScope.ORG,
        organizationId: null,
      });

      const scope = await service.resolveScope({ auth: { token: 'good-token' } });
      expect(scope).toBeNull();
    });
  });

  describe('rejection / fail-closed cases', () => {
    it('rejects a handshake that supplies orgId but NO token (the original vulnerability)', async () => {
      const scope = await service.resolveScope({ auth: { orgId } });
      expect(scope).toBeNull();
      expect(mockPrismaService.user.findFirst).not.toHaveBeenCalled();
    });

    it('rejects a handshake that self-claims platform with NO token', async () => {
      const scope = await service.resolveScope({ auth: { platform: true } });
      expect(scope).toBeNull();
    });

    it('rejects when the token fails verification and there is no session fallback', async () => {
      mockVerifyToken.mockRejectedValue(new Error('bad signature'));
      const scope = await service.resolveScope({ auth: { token: 'forged' } });
      expect(scope).toBeNull();
    });

    it('does NOT fall back to a client-claimed org when the token is invalid', async () => {
      mockVerifyToken.mockRejectedValue(new Error('expired'));
      const scope = await service.resolveScope({
        auth: { token: 'expired', orgId, platform: true },
      });
      expect(scope).toBeNull();
    });

    it('still honors a widget sessionId when a bad token is also present', async () => {
      mockVerifyToken.mockRejectedValue(new Error('expired'));
      const scope = await service.resolveScope({
        auth: { token: 'expired', sessionId },
      });
      expect(scope).toEqual({ sessionId });
    });

    it('rejects when the verified user no longer exists', async () => {
      mockVerifyToken.mockResolvedValue({ sub: 'user_ghost' });
      mockPrismaService.user.findFirst.mockResolvedValue(null);
      const scope = await service.resolveScope({ auth: { token: 'good-token' } });
      expect(scope).toBeNull();
    });

    it('rejects an ORG-scoped user with no org (nothing to join)', async () => {
      mockVerifyToken.mockResolvedValue({ sub: 'user_orphan' });
      mockPrismaService.user.findFirst.mockResolvedValue({
        accessScope: AccessScope.ORG,
        organizationId: null,
      });
      const scope = await service.resolveScope({ auth: { token: 'good-token' } });
      expect(scope).toBeNull();
    });

    it('rejects an empty handshake', async () => {
      expect(await service.resolveScope({})).toBeNull();
    });

    it('does not verify a token when CLERK_SECRET_KEY is unset (fail-closed)', async () => {
      mockConfigService.get.mockImplementation((key: string, def?: string) =>
        key === 'CLERK_SECRET_KEY' ? '' : def,
      );
      // Rebuild with the empty-secret config.
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WsAuthService,
          { provide: PrismaService, useValue: mockPrismaService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      const svc = module.get<WsAuthService>(WsAuthService);

      const scope = await svc.resolveScope({ auth: { token: 'whatever' } });
      expect(scope).toBeNull();
      expect(mockVerifyToken).not.toHaveBeenCalled();
    });
  });
});
