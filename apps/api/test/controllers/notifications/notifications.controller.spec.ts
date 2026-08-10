import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { Role, AccessScope } from '@prisma/client';
import { NotificationsController } from '../../../src/controllers/notifications/notifications.controller';
import { NotificationService } from '../../../src/services/notification.service';
import { PermissionGuard } from '../../../src/guards/permission.guard';
import { notificationListQuerySchema } from '../../../src/models/notification.dto';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('NotificationsController', () => {
  let controller: NotificationsController;

  const mockService = {
    list: jest.fn(),
    get: jest.fn(),
    unreadCount: jest.fn(),
    markSeen: jest.fn(),
    markRead: jest.fn(),
  };

  const orgId = '123e4567-e89b-12d3-a456-426614174000';
  const clientUser: CurrentUserData = {
    clerkId: 'user_client',
    email: 'client@test.com',
    id: 'client-user-id',
    role: Role.CLIENT,

    accessScope: AccessScope.ORG,

    roleKeys: ['org.owner'],
    organizationId: orgId,
    organization: { id: orgId, name: 'Test Org', slug: 'test-org' },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationService, useValue: mockService }, Reflector],
    })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(NotificationsController);
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('list() passes the query and the authenticated user through', async () => {
    mockService.list.mockResolvedValue({ items: [], nextCursor: null });
    await controller.list({ limit: 20 }, clientUser);
    expect(mockService.list).toHaveBeenCalledWith(clientUser, { limit: 20 });
  });

  it('unreadCount() delegates with the user', async () => {
    mockService.unreadCount.mockResolvedValue({ count: 2 });
    await controller.unreadCount(clientUser);
    expect(mockService.unreadCount).toHaveBeenCalledWith(clientUser);
  });

  it('markSeen() delegates with the user', async () => {
    mockService.markSeen.mockResolvedValue({ seenAt: new Date() });
    await controller.markSeen(clientUser);
    expect(mockService.markSeen).toHaveBeenCalledWith(clientUser);
  });

  it('markRead() delegates the id and the user', async () => {
    mockService.markRead.mockResolvedValue({ ok: true });
    await controller.markRead({ id: 'notif-1' }, clientUser);
    expect(mockService.markRead).toHaveBeenCalledWith(clientUser, 'notif-1');
  });

  it('get() delegates the id and the user', async () => {
    mockService.get.mockResolvedValue({ id: 'notif-1' });
    await controller.get({ id: 'notif-1' }, clientUser);
    expect(mockService.get).toHaveBeenCalledWith(clientUser, 'notif-1');
  });

  // The tenant boundary is the authenticated user, so the route surface must not
  // offer an org selector at all. If one is ever added, this fails.
  it('exposes no orgId parameter on any route', () => {
    const args = [
      controller.list.length,
      controller.get.length,
      controller.unreadCount.length,
      controller.markSeen.length,
      controller.markRead.length,
    ];
    expect(args).toEqual([2, 2, 1, 1, 2]);
  });

  // Route order matters: a literal path declared AFTER `:id` would be swallowed
  // by it. `unread-count` must stay ahead of the param route.
  it('declares the literal unread-count route before the :id route', () => {
    const source = NotificationsController.prototype.constructor.toString();
    expect(typeof source).toBe('string');
    const names = Object.getOwnPropertyNames(NotificationsController.prototype);
    expect(names.indexOf('unreadCount')).toBeLessThan(names.indexOf('get'));
  });

  describe('list query validation', () => {
    it('defaults limit to 20', () => {
      expect(notificationListQuerySchema.parse({})).toEqual({ limit: 20 });
    });

    it('rejects a limit above 50', () => {
      expect(() => notificationListQuerySchema.parse({ limit: '500' })).toThrow();
    });

    it('rejects a limit below 1', () => {
      expect(() => notificationListQuerySchema.parse({ limit: '0' })).toThrow();
    });

    it('rejects a non-uuid cursor', () => {
      expect(() =>
        notificationListQuerySchema.parse({ cursor: 'not-a-uuid' }),
      ).toThrow();
    });

    it('coerces a numeric-string limit', () => {
      expect(notificationListQuerySchema.parse({ limit: '10' })).toEqual({ limit: 10 });
    });
  });
});
