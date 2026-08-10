import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { Role, AccessScope } from '@prisma/client';
import { NotificationService } from '../../../src/services/notification.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { RealtimeService } from '../../../src/services/realtime.service';
import { NotificationMailerService } from '../../../src/services/notification-mailer.service';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('NotificationService', () => {
  let service: NotificationService;

  const orgId = '123e4567-e89b-12d3-a456-426614174000';
  const otherOrgId = '223e4567-e89b-12d3-a456-426614174000';

  const mockPrisma = {
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    notificationRead: { upsert: jest.fn() },
    user: { findUnique: jest.fn(), update: jest.fn() },
  };

  const mockRealtime = { emitNotification: jest.fn() };
  const mockMailer = { send: jest.fn() };
  const mockConfig = {
    get: (key: string, defaultValue?: string) =>
      key === 'DASHBOARD_URL' ? 'https://app.example.com' : defaultValue,
  };

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

  // Platform staff: ADMIN/SUPER_ADMIN with no org of their own. They already see
  // every org's handovers in the Inbox, so the bell matches that scope.
  const platformUser: CurrentUserData = {
    ...clientUser,
    id: 'platform-user-id',
    role: Role.SUPER_ADMIN,

    accessScope: AccessScope.PLATFORM,

    roleKeys: ['platform.super_admin'],
    organizationId: null,
    organization: null,
  };

  // A CLIENT with no org is a misconfigured account, NOT a superuser. It must
  // never fall through to the platform (unscoped) branch.
  const clientNoOrg: CurrentUserData = {
    ...clientUser,
    id: 'client-no-org',
    role: Role.CLIENT,

    accessScope: AccessScope.ORG,

    roleKeys: ['org.owner'],
    organizationId: null,
    organization: null,
  };

  const emitInput = {
    organizationId: orgId,
    agentId: 'agent-1',
    type: 'HANDOVER_REQUESTED' as const,
    severity: 'URGENT' as const,
    title: 'A visitor asked for a human on Support Bot',
    entityType: 'conversation',
    entityId: 'sess-pub',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.notification.create.mockResolvedValue({
      id: 'notif-1',
      createdAt: new Date('2026-07-27T10:00:00Z'),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RealtimeService, useValue: mockRealtime },
        { provide: NotificationMailerService, useValue: mockMailer },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get(NotificationService);
  });

  describe('emit', () => {
    it('writes the row and pushes over the socket', async () => {
      await service.emit(emitInput);

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: orgId,
            type: 'HANDOVER_REQUESTED',
            severity: 'URGENT',
            entityId: 'sess-pub',
          }),
        }),
      );
      expect(mockRealtime.emitNotification).toHaveBeenCalledWith(
        orgId,
        expect.objectContaining({ id: 'notif-1', title: emitInput.title }),
      );
    });

    it('does not email when the producer did not ask for it', async () => {
      await service.emit(emitInput);
      expect(mockMailer.send).not.toHaveBeenCalled();
    });

    it('does not email when the toggle is off', async () => {
      await service.emit({
        ...emitInput,
        email: {
          enabled: false,
          recipients: [],
          templateKey: 'HANDOVER_REQUESTED',
          vars: {},
        },
      });
      expect(mockMailer.send).not.toHaveBeenCalled();
    });

    it('emails when the toggle is on', async () => {
      await service.emit({
        ...emitInput,
        email: {
          enabled: true,
          recipients: ['ops@acme.com'],
          templateKey: 'HANDOVER_REQUESTED',
          vars: { orgName: 'Acme' },
        },
      });
      expect(mockMailer.send).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: orgId,
          recipients: ['ops@acme.com'],
          tagType: 'HANDOVER_REQUESTED',
        }),
      );
    });

    // Email is a lower-trust channel we don't control once sent. A
    // publicSessionId is a bearer credential for the unauthenticated public chat
    // endpoints, so the link must be built from the notification id — which
    // grants nothing without a login — not from the session id.
    describe('email deep link', () => {
      const withEmail = {
        ...emitInput,
        email: {
          enabled: true,
          recipients: ['ops@acme.com'],
          templateKey: 'HANDOVER_REQUESTED' as const,
          vars: { orgName: 'Acme', agentName: 'Bot' },
        },
      };

      it('links by notification id, not session id', async () => {
        await service.emit(withEmail);

        const vars = (mockMailer.send.mock.calls[0][0] as { vars: Record<string, string> })
          .vars;
        expect(vars.conversationUrl).toBe(
          'https://app.example.com/dashboard/inbox?n=notif-1',
        );
      });

      it('never leaks the session id into the email variables', async () => {
        await service.emit(withEmail);

        const vars = (mockMailer.send.mock.calls[0][0] as { vars: Record<string, string> })
          .vars;
        // entityId (the publicSessionId) is on the notification row and the
        // socket payload — both org-authenticated — but must not reach the mail.
        expect(JSON.stringify(vars)).not.toContain('sess-pub');
      });

      it('overrides any conversationUrl a producer tries to pass', async () => {
        await service.emit({
          ...withEmail,
          email: {
            ...withEmail.email,
            vars: {
              ...withEmail.email.vars,
              conversationUrl: 'https://evil.example/?session=sess-pub',
            },
          },
        });

        const vars = (mockMailer.send.mock.calls[0][0] as { vars: Record<string, string> })
          .vars;
        expect(vars.conversationUrl).toBe(
          'https://app.example.com/dashboard/inbox?n=notif-1',
        );
      });

      it('falls back to the plain Inbox when there is no row to link to', async () => {
        mockPrisma.notification.create.mockRejectedValueOnce(new Error('db down'));
        await service.emit(withEmail);

        const vars = (mockMailer.send.mock.calls[0][0] as { vars: Record<string, string> })
          .vars;
        expect(vars.conversationUrl).toBe('https://app.example.com/dashboard/inbox');
      });
    });

    it('truncates an over-long title to the column width', async () => {
      await service.emit({ ...emitInput, title: 'x'.repeat(400) });
      const data = mockPrisma.notification.create.mock.calls[0][0].data;
      expect(data.title).toHaveLength(300);
    });

    // Fire-and-forget contract — emit runs on the chat hot path.
    describe('failure isolation', () => {
      it('never throws when the DB write fails', async () => {
        mockPrisma.notification.create.mockRejectedValueOnce(new Error('db down'));
        await expect(service.emit(emitInput)).resolves.toBeUndefined();
      });

      it('never throws when the socket emit fails', async () => {
        mockRealtime.emitNotification.mockRejectedValueOnce(new Error('socket down'));
        await expect(service.emit(emitInput)).resolves.toBeUndefined();
      });

      it('never throws when the mailer fails', async () => {
        mockMailer.send.mockRejectedValueOnce(new Error('mail down'));
        await expect(
          service.emit({
            ...emitInput,
            email: {
              enabled: true,
              recipients: [],
              templateKey: 'HANDOVER_REQUESTED',
              vars: {},
            },
          }),
        ).resolves.toBeUndefined();
      });

      // A waiting visitor is the thing that matters — if the bell row failed but
      // the customer asked to be emailed, still email them.
      it('still sends the email when the DB write failed', async () => {
        mockPrisma.notification.create.mockRejectedValueOnce(new Error('db down'));
        await service.emit({
          ...emitInput,
          email: {
            enabled: true,
            recipients: ['ops@acme.com'],
            templateKey: 'HANDOVER_REQUESTED',
            vars: {},
          },
        });
        expect(mockMailer.send).toHaveBeenCalled();
      });
    });
  });

  describe('list', () => {
    it('scopes to the caller organization', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      await service.list(clientUser, {});

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: orgId } }),
      );
    });

    it('reads per-item read state for the calling user only', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      await service.list(clientUser, {});

      const args = mockPrisma.notification.findMany.mock.calls[0][0];
      expect(args.select.reads.where).toEqual({ userId: clientUser.id });
    });

    it('maps the reads relation to a boolean', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([
        { id: 'n1', title: 'a', reads: [{ userId: clientUser.id }] },
        { id: 'n2', title: 'b', reads: [] },
      ]);

      const result = await service.list(clientUser, {});
      expect(result.items[0]).toMatchObject({ id: 'n1', read: true });
      expect(result.items[1]).toMatchObject({ id: 'n2', read: false });
      expect(result.items[0]).not.toHaveProperty('reads');
    });

    // Platform staff read across orgs — matching what they already see in the
    // Inbox, so they can't be shown a waiting conversation with no way to be
    // told about it.
    it('reads across all orgs for platform staff', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      await service.list(platformUser, {});

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    // The dangerous case: a CLIENT whose org is missing must get NOTHING, never
    // the platform firehose.
    it('returns an empty page for a CLIENT with no organization', async () => {
      const result = await service.list(clientNoOrg, {});
      expect(result).toEqual({ items: [], nextCursor: null });
      expect(mockPrisma.notification.findMany).not.toHaveBeenCalled();
    });

    it('clamps limit to the maximum page size', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      await service.list(clientUser, { limit: 5000 });

      // take = limit + 1 for the has-more probe.
      expect(mockPrisma.notification.findMany.mock.calls[0][0].take).toBe(51);
    });

    it('returns a nextCursor only when there is another page', async () => {
      const rows = Array.from({ length: 21 }, (_, i) => ({
        id: `n${i}`,
        title: 't',
        reads: [],
      }));
      mockPrisma.notification.findMany.mockResolvedValue(rows);

      const result = await service.list(clientUser, { limit: 20 });
      expect(result.items).toHaveLength(20);
      expect(result.nextCursor).toBe('n19');
    });

    it('returns a null cursor on the last page', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([
        { id: 'n1', title: 't', reads: [] },
      ]);
      const result = await service.list(clientUser, { limit: 20 });
      expect(result.nextCursor).toBeNull();
    });
  });

  // Backs the ?n= email deep link — so it is the one place an email recipient
  // can reach, and must be strictly org-scoped.
  describe('get', () => {
    it('returns the notification when it is in my org', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue({
        id: 'notif-1',
        type: 'HANDOVER_REQUESTED',
        entityType: 'conversation',
        entityId: 'sess-pub',
      });

      const result = await service.get(clientUser, 'notif-1');

      expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith({
        where: { id: 'notif-1', organizationId: orgId },
        select: { id: true, type: true, entityType: true, entityId: true },
      });
      expect(result.entityId).toBe('sess-pub');
    });

    // An email can be forwarded anywhere, so the id in it must be useless
    // without a login in the owning org.
    it('404s for another org notification rather than resolving it', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);
      await expect(service.get(clientUser, 'someone-elses')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('resolves any org notification for platform staff', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue({
        id: 'notif-1',
        type: 'HANDOVER_REQUESTED',
        entityType: 'conversation',
        entityId: 'sess-pub',
      });

      await service.get(platformUser, 'notif-1');

      expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'notif-1' } }),
      );
    });

    it('404s for a CLIENT with no organization', async () => {
      await expect(service.get(clientNoOrg, 'notif-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.notification.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('unreadCount', () => {
    it('counts only notifications newer than the seen cursor', async () => {
      const seenAt = new Date('2026-07-27T09:00:00Z');
      mockPrisma.user.findUnique.mockResolvedValue({ notificationsSeenAt: seenAt });
      mockPrisma.notification.count.mockResolvedValue(3);

      const result = await service.unreadCount(clientUser);

      expect(mockPrisma.notification.count).toHaveBeenCalledWith({
        where: { organizationId: orgId, createdAt: { gt: seenAt } },
      });
      expect(result).toEqual({ count: 3 });
    });

    it('counts everything when the user has never opened the panel', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ notificationsSeenAt: null });
      mockPrisma.notification.count.mockResolvedValue(7);

      await service.unreadCount(clientUser);
      expect(mockPrisma.notification.count).toHaveBeenCalledWith({
        where: { organizationId: orgId },
      });
    });

    it('counts across all orgs for platform staff', async () => {
      const seenAt = new Date('2026-07-27T09:00:00Z');
      mockPrisma.user.findUnique.mockResolvedValue({ notificationsSeenAt: seenAt });
      mockPrisma.notification.count.mockResolvedValue(11);

      await service.unreadCount(platformUser);

      expect(mockPrisma.notification.count).toHaveBeenCalledWith({
        where: { createdAt: { gt: seenAt } },
      });
    });

    it('returns zero for a CLIENT with no organization', async () => {
      const result = await service.unreadCount(clientNoOrg);
      expect(result).toEqual({ count: 0 });
      expect(mockPrisma.notification.count).not.toHaveBeenCalled();
    });
  });

  describe('markSeen', () => {
    it('stamps the cursor on the calling user', async () => {
      mockPrisma.user.update.mockResolvedValue({});
      const result = await service.markSeen(clientUser);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: clientUser.id } }),
      );
      expect(result.seenAt).toBeInstanceOf(Date);
    });
  });

  describe('markRead', () => {
    it('upserts a read row when the notification is in my org', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue({ id: 'n1' });
      mockPrisma.notificationRead.upsert.mockResolvedValue({});

      const result = await service.markRead(clientUser, 'n1');

      expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith({
        where: { id: 'n1', organizationId: orgId },
        select: { id: true },
      });
      expect(result).toEqual({ ok: true });
    });

    // Without the org-scoped existence check, marking would confirm that
    // another organization's notification id exists.
    it('refuses a notification that is not in my org', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      const result = await service.markRead(clientUser, 'someone-elses-notif');

      expect(result).toEqual({ ok: false });
      expect(mockPrisma.notificationRead.upsert).not.toHaveBeenCalled();
    });

    it('lets platform staff mark any org notification read', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue({ id: 'n1' });
      mockPrisma.notificationRead.upsert.mockResolvedValue({});

      const result = await service.markRead(platformUser, 'n1');

      expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith({
        where: { id: 'n1' },
        select: { id: true },
      });
      expect(result).toEqual({ ok: true });
    });

    it('refuses a CLIENT with no organization', async () => {
      const result = await service.markRead(clientNoOrg, 'n1');
      expect(result).toEqual({ ok: false });
      expect(mockPrisma.notification.findFirst).not.toHaveBeenCalled();
    });

    it('does not leak another org id into the lookup', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);
      await service.markRead(clientUser, 'n1');
      const where = mockPrisma.notification.findFirst.mock.calls[0][0].where;
      expect(where.organizationId).toBe(orgId);
      expect(where.organizationId).not.toBe(otherOrgId);
    });
  });
});
