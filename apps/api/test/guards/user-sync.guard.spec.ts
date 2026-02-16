import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserSyncGuard } from '../../src/guards/user-sync.guard';
import { UsersService } from '../../src/services/users.service';
import { Role } from '@prisma/client';

describe('UserSyncGuard', () => {
  let guard: UserSyncGuard;

  const mockOrganization = {
    id: 'org-uuid-1',
    name: 'Test Org',
    slug: 'test-org',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSyncedUser = {
    id: 'user-uuid-1',
    email: 'test@example.com',
    name: null,
    role: Role.CLIENT,
    auth0Id: 'auth0|123456',
    organizationId: mockOrganization.id,
    organization: mockOrganization,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUsersService = {
    syncOrCreateUser: jest.fn(),
  };

  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  function createMockContext(user: unknown): {
    context: ExecutionContext;
    request: { user: unknown };
  } {
    const request = { user };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
        getNext: () => jest.fn(),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn() as unknown,
      getArgs: () => [],
      getArgByIndex: () => undefined,
      switchToRpc: () => ({} as never),
      switchToWs: () => ({} as never),
      getType: () => 'http' as const,
    } as unknown as ExecutionContext;
    return { context, request };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserSyncGuard,
        { provide: UsersService, useValue: mockUsersService },
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    guard = module.get<UserSyncGuard>(UserSyncGuard);

    jest.clearAllMocks();
    mockReflector.getAllAndOverride.mockReturnValue(false);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('public routes', () => {
    it('should allow access for public routes without sync', async () => {
      mockReflector.getAllAndOverride.mockReturnValue(true);
      const { context } = createMockContext(null);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockUsersService.syncOrCreateUser).not.toHaveBeenCalled();
    });
  });

  describe('no user on request', () => {
    it('should allow access when no user is present', async () => {
      const { context } = createMockContext(null);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockUsersService.syncOrCreateUser).not.toHaveBeenCalled();
    });

    it('should allow access when user is undefined', async () => {
      const { context } = createMockContext(undefined);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockUsersService.syncOrCreateUser).not.toHaveBeenCalled();
    });
  });

  describe('user sync via service', () => {
    it('should delegate to UsersService.syncOrCreateUser', async () => {
      const jwtUser = {
        auth0Id: 'auth0|123456',
        email: 'test@example.com',
        roles: ['CLIENT'],
      };
      mockUsersService.syncOrCreateUser.mockResolvedValue(mockSyncedUser);

      const { context } = createMockContext(jwtUser);
      await guard.canActivate(context);

      expect(mockUsersService.syncOrCreateUser).toHaveBeenCalledWith(jwtUser);
    });

    it('should attach synced user data to request', async () => {
      const jwtUser = {
        auth0Id: 'auth0|123456',
        email: 'test@example.com',
        roles: ['CLIENT'],
      };
      mockUsersService.syncOrCreateUser.mockResolvedValue(mockSyncedUser);

      const { context, request } = createMockContext(jwtUser);
      await guard.canActivate(context);

      expect(request.user).toEqual({
        ...jwtUser,
        id: mockSyncedUser.id,
        role: mockSyncedUser.role,
        organizationId: mockSyncedUser.organizationId,
        organization: mockSyncedUser.organization,
      });
    });

    it('should attach null organization for SUPER_ADMIN users', async () => {
      const jwtUser = {
        auth0Id: 'auth0|superadmin',
        email: 'admin@codeweaves.com',
        roles: ['SUPER_ADMIN'],
      };
      const mockSuperAdminUser = {
        id: 'superadmin-uuid-1',
        email: 'admin@codeweaves.com',
        name: 'Super Admin',
        role: Role.SUPER_ADMIN,
        auth0Id: 'auth0|superadmin',
        organizationId: null,
        organization: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockUsersService.syncOrCreateUser.mockResolvedValue(mockSuperAdminUser);

      const { context, request } = createMockContext(jwtUser);
      await guard.canActivate(context);

      expect(request.user).toEqual({
        ...jwtUser,
        id: mockSuperAdminUser.id,
        role: mockSuperAdminUser.role,
        organizationId: null,
        organization: null,
      });
    });

    it('should return true after sync', async () => {
      const jwtUser = {
        auth0Id: 'auth0|123456',
        email: 'test@example.com',
        roles: [],
      };
      mockUsersService.syncOrCreateUser.mockResolvedValue(mockSyncedUser);

      const { context } = createMockContext(jwtUser);
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe('caching', () => {
    it('should use cached user on second request (no extra DB call)', async () => {
      const jwtUser = {
        auth0Id: 'auth0|cached',
        email: 'cached@example.com',
        roles: [],
      };
      const user = {
        ...mockSyncedUser,
        auth0Id: 'auth0|cached',
        email: 'cached@example.com',
      };
      mockUsersService.syncOrCreateUser.mockResolvedValue(user);

      // First request — cache miss
      const { context: ctx1 } = createMockContext(jwtUser);
      await guard.canActivate(ctx1);
      expect(mockUsersService.syncOrCreateUser).toHaveBeenCalledTimes(1);

      // Second request — cache hit
      const { context: ctx2, request: req2 } = createMockContext(jwtUser);
      await guard.canActivate(ctx2);
      expect(mockUsersService.syncOrCreateUser).toHaveBeenCalledTimes(1);
      expect(req2.user).toMatchObject({
        id: mockSyncedUser.id,
        role: mockSyncedUser.role,
        organizationId: mockSyncedUser.organizationId,
      });
    });

    it('should refetch after cache TTL expires', async () => {
      const jwtUser = {
        auth0Id: 'auth0|ttl-test',
        email: 'ttl@example.com',
        roles: [],
      };
      const user = {
        ...mockSyncedUser,
        auth0Id: 'auth0|ttl-test',
        email: 'ttl@example.com',
      };
      mockUsersService.syncOrCreateUser.mockResolvedValue(user);

      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      // First request
      const { context: ctx1 } = createMockContext(jwtUser);
      await guard.canActivate(ctx1);
      expect(mockUsersService.syncOrCreateUser).toHaveBeenCalledTimes(1);

      // Advance past TTL (60s + 1s)
      jest.spyOn(Date, 'now').mockReturnValue(now + 61_000);

      // Second request — cache expired
      const { context: ctx2 } = createMockContext(jwtUser);
      await guard.canActivate(ctx2);
      expect(mockUsersService.syncOrCreateUser).toHaveBeenCalledTimes(2);

      jest.restoreAllMocks();
    });

    it('should not share cache between different users', async () => {
      const user1 = {
        auth0Id: 'auth0|user1',
        email: 'user1@example.com',
        roles: [],
      };
      const user2 = {
        auth0Id: 'auth0|user2',
        email: 'user2@example.com',
        roles: [],
      };

      const synced1 = { ...mockSyncedUser, id: 'uid-1', auth0Id: 'auth0|user1' };
      const synced2 = { ...mockSyncedUser, id: 'uid-2', auth0Id: 'auth0|user2' };

      mockUsersService.syncOrCreateUser
        .mockResolvedValueOnce(synced1)
        .mockResolvedValueOnce(synced2);

      const { context: ctx1 } = createMockContext(user1);
      await guard.canActivate(ctx1);

      const { context: ctx2, request: req2 } = createMockContext(user2);
      await guard.canActivate(ctx2);

      expect(mockUsersService.syncOrCreateUser).toHaveBeenCalledTimes(2);
      expect(req2.user).toMatchObject({ id: 'uid-2' });
    });

    it('should serve within TTL without service call', async () => {
      const jwtUser = {
        auth0Id: 'auth0|within-ttl',
        email: 'ttl@example.com',
        roles: [],
      };
      const user = {
        ...mockSyncedUser,
        auth0Id: 'auth0|within-ttl',
        email: 'ttl@example.com',
      };
      mockUsersService.syncOrCreateUser.mockResolvedValue(user);

      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const { context: ctx1 } = createMockContext(jwtUser);
      await guard.canActivate(ctx1);

      // 30s later — still within TTL
      jest.spyOn(Date, 'now').mockReturnValue(now + 30_000);

      const { context: ctx2 } = createMockContext(jwtUser);
      await guard.canActivate(ctx2);

      expect(mockUsersService.syncOrCreateUser).toHaveBeenCalledTimes(1);

      jest.restoreAllMocks();
    });
  });
});
