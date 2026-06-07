import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { UserSyncInterceptor } from '../../src/interceptors/user-sync.interceptor';
import { UsersService } from '../../src/services/users.service';
import { Role } from '@prisma/client';

describe('UserSyncInterceptor', () => {
  let interceptor: UserSyncInterceptor;

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
    clerkId: 'user_123456',
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

  const mockCallHandler: CallHandler = {
    handle: jest.fn().mockReturnValue(of('test')),
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
        UserSyncInterceptor,
        { provide: UsersService, useValue: mockUsersService },
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    interceptor = module.get<UserSyncInterceptor>(UserSyncInterceptor);

    jest.clearAllMocks();
    mockReflector.getAllAndOverride.mockReturnValue(false);
    (mockCallHandler.handle as jest.Mock).mockReturnValue(of('test'));
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  describe('public routes', () => {
    it('should skip sync for public routes', async () => {
      mockReflector.getAllAndOverride.mockReturnValue(true);
      const { context } = createMockContext(null);

      const result = await interceptor.intercept(context, mockCallHandler);

      expect(result).toBeDefined();
      expect(mockUsersService.syncOrCreateUser).not.toHaveBeenCalled();
      expect(mockCallHandler.handle).toHaveBeenCalled();
    });
  });

  describe('no user on request', () => {
    it('should skip sync when no user is present', async () => {
      const { context } = createMockContext(null);

      const result = await interceptor.intercept(context, mockCallHandler);

      expect(result).toBeDefined();
      expect(mockUsersService.syncOrCreateUser).not.toHaveBeenCalled();
    });

    it('should skip sync when user is undefined', async () => {
      const { context } = createMockContext(undefined);

      const result = await interceptor.intercept(context, mockCallHandler);

      expect(result).toBeDefined();
      expect(mockUsersService.syncOrCreateUser).not.toHaveBeenCalled();
    });
  });

  describe('user sync via service', () => {
    it('should delegate to UsersService.syncOrCreateUser', async () => {
      const jwtUser = {
        clerkId: 'user_123456',
        email: 'test@example.com',
      };
      mockUsersService.syncOrCreateUser.mockResolvedValue(mockSyncedUser);

      const { context } = createMockContext(jwtUser);
      await interceptor.intercept(context, mockCallHandler);

      expect(mockUsersService.syncOrCreateUser).toHaveBeenCalledWith(jwtUser);
    });

    it('should attach synced user data to request', async () => {
      const jwtUser = {
        clerkId: 'user_123456',
        email: 'test@example.com',
      };
      mockUsersService.syncOrCreateUser.mockResolvedValue(mockSyncedUser);

      const { context, request } = createMockContext(jwtUser);
      await interceptor.intercept(context, mockCallHandler);

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
        clerkId: 'user_superadmin',
        email: 'admin@codeweaves.com',
      };
      const mockSuperAdminUser = {
        id: 'superadmin-uuid-1',
        email: 'admin@codeweaves.com',
        name: 'Super Admin',
        role: Role.SUPER_ADMIN,
        clerkId: 'user_superadmin',
        organizationId: null,
        organization: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockUsersService.syncOrCreateUser.mockResolvedValue(mockSuperAdminUser);

      const { context, request } = createMockContext(jwtUser);
      await interceptor.intercept(context, mockCallHandler);

      expect(request.user).toEqual({
        ...jwtUser,
        id: mockSuperAdminUser.id,
        role: mockSuperAdminUser.role,
        organizationId: null,
        organization: null,
      });
    });

    it('should call next.handle() after sync', async () => {
      const jwtUser = {
        clerkId: 'user_123456',
        email: 'test@example.com',
      };
      mockUsersService.syncOrCreateUser.mockResolvedValue(mockSyncedUser);

      const { context } = createMockContext(jwtUser);
      await interceptor.intercept(context, mockCallHandler);

      expect(mockCallHandler.handle).toHaveBeenCalled();
    });
  });

  describe('caching', () => {
    it('should use cached user on second request (no extra DB call)', async () => {
      const jwtUser = {
        clerkId: 'user_cached',
        email: 'cached@example.com',
      };
      const user = {
        ...mockSyncedUser,
        clerkId: 'user_cached',
        email: 'cached@example.com',
      };
      mockUsersService.syncOrCreateUser.mockResolvedValue(user);

      // First request — cache miss
      const { context: ctx1 } = createMockContext(jwtUser);
      await interceptor.intercept(ctx1, mockCallHandler);
      expect(mockUsersService.syncOrCreateUser).toHaveBeenCalledTimes(1);

      // Second request — cache hit
      const { context: ctx2, request: req2 } = createMockContext(jwtUser);
      await interceptor.intercept(ctx2, mockCallHandler);
      expect(mockUsersService.syncOrCreateUser).toHaveBeenCalledTimes(1);
      expect(req2.user).toMatchObject({
        id: mockSyncedUser.id,
        role: mockSyncedUser.role,
        organizationId: mockSyncedUser.organizationId,
      });
    });

    it('should refetch after cache TTL expires', async () => {
      const jwtUser = {
        clerkId: 'user_ttl-test',
        email: 'ttl@example.com',
      };
      const user = {
        ...mockSyncedUser,
        clerkId: 'user_ttl-test',
        email: 'ttl@example.com',
      };
      mockUsersService.syncOrCreateUser.mockResolvedValue(user);

      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      // First request
      const { context: ctx1 } = createMockContext(jwtUser);
      await interceptor.intercept(ctx1, mockCallHandler);
      expect(mockUsersService.syncOrCreateUser).toHaveBeenCalledTimes(1);

      // Advance past TTL (60s + 1s)
      jest.spyOn(Date, 'now').mockReturnValue(now + 61_000);

      // Second request — cache expired
      const { context: ctx2 } = createMockContext(jwtUser);
      await interceptor.intercept(ctx2, mockCallHandler);
      expect(mockUsersService.syncOrCreateUser).toHaveBeenCalledTimes(2);

      jest.restoreAllMocks();
    });

    it('should not share cache between different users', async () => {
      const user1 = {
        clerkId: 'user_user1',
        email: 'user1@example.com',
      };
      const user2 = {
        clerkId: 'user_user2',
        email: 'user2@example.com',
      };

      const synced1 = { ...mockSyncedUser, id: 'uid-1', clerkId: 'user_user1' };
      const synced2 = { ...mockSyncedUser, id: 'uid-2', clerkId: 'user_user2' };

      mockUsersService.syncOrCreateUser
        .mockResolvedValueOnce(synced1)
        .mockResolvedValueOnce(synced2);

      const { context: ctx1 } = createMockContext(user1);
      await interceptor.intercept(ctx1, mockCallHandler);

      const { context: ctx2, request: req2 } = createMockContext(user2);
      await interceptor.intercept(ctx2, mockCallHandler);

      expect(mockUsersService.syncOrCreateUser).toHaveBeenCalledTimes(2);
      expect(req2.user).toMatchObject({ id: 'uid-2' });
    });

    it('should serve within TTL without service call', async () => {
      const jwtUser = {
        clerkId: 'user_within-ttl',
        email: 'ttl@example.com',
      };
      const user = {
        ...mockSyncedUser,
        clerkId: 'user_within-ttl',
        email: 'ttl@example.com',
      };
      mockUsersService.syncOrCreateUser.mockResolvedValue(user);

      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const { context: ctx1 } = createMockContext(jwtUser);
      await interceptor.intercept(ctx1, mockCallHandler);

      // 30s later — still within TTL
      jest.spyOn(Date, 'now').mockReturnValue(now + 30_000);

      const { context: ctx2 } = createMockContext(jwtUser);
      await interceptor.intercept(ctx2, mockCallHandler);

      expect(mockUsersService.syncOrCreateUser).toHaveBeenCalledTimes(1);

      jest.restoreAllMocks();
    });
  });
});
