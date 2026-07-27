import { Test, TestingModule } from '@nestjs/testing';
import { NotificationMailerService } from '../../../src/services/notification-mailer.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { EmailService } from '../../../src/services/email.service';
import { EmailTemplateService } from '../../../src/services/email-template.service';

describe('NotificationMailerService', () => {
  let service: NotificationMailerService;

  const orgId = '123e4567-e89b-12d3-a456-426614174000';

  const mockPrisma = { user: { findMany: jest.fn() } };
  const mockEmail = { send: jest.fn() };
  const mockTemplates = { render: jest.fn() };

  const baseInput = {
    organizationId: orgId,
    templateKey: 'HANDOVER_REQUESTED' as const,
    vars: { orgName: 'Acme', agentName: 'Bot', conversationUrl: 'https://x.dev' },
    recipients: [] as string[],
    tagType: 'HANDOVER_REQUESTED',
  };

  beforeEach(async () => {
    // jest.config sets resetMocks: true, which wipes implementations between
    // tests — so the happy-path returns are (re)established here, not inline.
    mockEmail.send.mockResolvedValue({ id: 'e1' });
    mockTemplates.render.mockResolvedValue({
      subject: 'Subject',
      html: '<p>Body</p>',
      text: 'Body',
    });
    mockPrisma.user.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationMailerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmail },
        { provide: EmailTemplateService, useValue: mockTemplates },
      ],
    }).compile();
    service = module.get(NotificationMailerService);
  });

  describe('recipient resolution', () => {
    it('falls back to every member of the organization when the list is empty', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { email: 'a@example.com' },
        { email: 'b@example.com' },
      ]);

      await service.send(baseInput);

      // Scoped by organizationId — the tenant boundary is in the query.
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: orgId, deletedAt: null },
        }),
      );
      expect(mockEmail.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: ['a@example.com', 'b@example.com'] }),
      );
    });

    it('uses the explicit list verbatim and does not query members', async () => {
      await service.send({
        ...baseInput,
        recipients: ['support@acme.com'],
      });

      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
      expect(mockEmail.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: ['support@acme.com'] }),
      );
    });

    it('lowercases and de-duplicates addresses', async () => {
      await service.send({
        ...baseInput,
        recipients: ['Ops@Acme.com', 'ops@acme.com', ' OPS@acme.com '],
      });

      expect(mockEmail.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: ['ops@acme.com'] }),
      );
    });

    it('drops malformed addresses', async () => {
      await service.send({
        ...baseInput,
        recipients: ['good@example.com', 'not-an-email', '@nope', 'x@y'],
      });

      expect(mockEmail.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: ['good@example.com'] }),
      );
    });

    it('caps the recipient list at 20', async () => {
      const many = Array.from({ length: 40 }, (_, i) => `u${i}@example.com`);
      await service.send({ ...baseInput, recipients: many });

      const call = mockEmail.send.mock.calls[0][0] as { to: string[] };
      expect(call.to).toHaveLength(20);
    });

    it('sends nothing when no recipient survives resolution', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.send(baseInput);
      expect(mockEmail.send).not.toHaveBeenCalled();
    });
  });

  /**
   * HARD INVARIANT: platform staff (ADMIN/SUPER_ADMIN with no org) must never
   * receive a notification email — for handover today, or for any type added
   * later. These tests fail if someone widens the recipient query.
   */
  describe('platform staff are never emailed', () => {
    it('resolves the org fallback by organizationId equality, so a null-org user cannot match', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ email: 'member@acme.com' }]);
      await service.send(baseInput);

      const where = mockPrisma.user.findMany.mock.calls[0][0].where;
      // Plain equality on the tenant column IS the guarantee. An OR, an `in`,
      // a role filter, or a null-permitting shape would all break it.
      expect(where.organizationId).toBe(orgId);
      expect(where).not.toHaveProperty('OR');
      expect(where).not.toHaveProperty('role');
      expect(where.organizationId).not.toBeNull();
      expect(typeof where.organizationId).toBe('string');
    });

    it('never queries users by role', async () => {
      await service.send(baseInput);
      const args = JSON.stringify(mockPrisma.user.findMany.mock.calls[0][0]);
      expect(args).not.toContain('SUPER_ADMIN');
      expect(args).not.toContain('ADMIN');
    });

    it('exposes no all-admins broadcast path', () => {
      const proto = Object.getOwnPropertyNames(
        NotificationMailerService.prototype,
      );
      // Only the constructor, the single public entry point, and the private
      // resolver. A future "notifyAllAdmins" would show up here.
      expect(proto.sort()).toEqual(['constructor', 'resolveRecipients', 'send']);
    });
  });

  describe('rendering', () => {
    it('renders the template and forwards subject/html/text plus the tag', async () => {
      await service.send({ ...baseInput, recipients: ['a@example.com'] });

      expect(mockTemplates.render).toHaveBeenCalledWith(
        'HANDOVER_REQUESTED',
        baseInput.vars,
      );
      expect(mockEmail.send).toHaveBeenCalledWith({
        to: ['a@example.com'],
        subject: 'Subject',
        html: '<p>Body</p>',
        text: 'Body',
        tags: { type: 'HANDOVER_REQUESTED' },
      });
    });
  });

  // The whole point of the fire-and-forget contract: the notification row is
  // already durable, so nothing here may propagate.
  describe('failure isolation', () => {
    it('swallows a template render failure', async () => {
      mockTemplates.render.mockRejectedValueOnce(new Error('template gone'));
      await expect(
        service.send({ ...baseInput, recipients: ['a@example.com'] }),
      ).resolves.toBeUndefined();
      expect(mockEmail.send).not.toHaveBeenCalled();
    });

    it('swallows a transport failure', async () => {
      mockEmail.send.mockRejectedValueOnce(new Error('resend down'));
      await expect(
        service.send({ ...baseInput, recipients: ['a@example.com'] }),
      ).resolves.toBeUndefined();
    });

    it('swallows a member-lookup failure', async () => {
      mockPrisma.user.findMany.mockRejectedValueOnce(new Error('db down'));
      await expect(service.send(baseInput)).resolves.toBeUndefined();
    });
  });
});
