import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvitationsService } from '../../../src/services/invitations.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { EmailService } from '../../../src/services/email.service';
import { EmailTemplateService } from '../../../src/services/email-template.service';
import { ClerkManagementService } from '../../../src/services/clerk-management.service';
import { InvitationLoggerService } from '../../../src/common/logger/invitation.logger';
import { InvitationStatus, Prisma, Role } from '@prisma/client';

describe('InvitationsService', () => {
  let service: InvitationsService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
    },
    userInvitation: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    // The invite template greets the inviting organization by name.
    organization: {
      findUnique: jest.fn(),
    },
  };

  const mockEmailService = {
    send: jest.fn(),
  };

  // The invite body now comes from the DB-backed TEAM_INVITATION template.
  const mockEmailTemplates = { render: jest.fn() };

  const mockConfigService = {
    get: (key: string, defaultValue?: string) => {
      const config: Record<string, string> = {
        DASHBOARD_URL: 'http://localhost:3000',
      };
      return config[key] ?? defaultValue;
    },
  };

  const mockClerkManagement = {
    createInvitation: jest.fn(),
    revokeInvitation: jest.fn(),
  };

  const mockInvitation = {
    id: 'inv-uuid-1',
    email: 'new@example.com',
    role: Role.CLIENT,
    organizationId: 'org-uuid-1',
    token: 'token-uuid-1',
    reissueToken: 'reissue-uuid-1',
    reissueCount: 0,
    status: InvitationStatus.PENDING,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    invitedBy: 'user-uuid-1',
    clerkInvitationId: null as string | null,
  };

  beforeEach(async () => {
    // jest.config sets resetMocks: true, so implementations are (re)established
    // here rather than at declaration.
    mockEmailTemplates.render.mockResolvedValue({
      subject: 'You have been invited to Klivo',
      html: '<p>invite</p>',
      text: 'invite',
    });
    mockPrisma.organization.findUnique.mockResolvedValue({ name: 'Test Org' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmailService },
        { provide: EmailTemplateService, useValue: mockEmailTemplates },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ClerkManagementService, useValue: mockClerkManagement },
        {
          provide: InvitationLoggerService,
          useValue: {
            logInvitationCreated: jest.fn(),
            logInvitationCreationFailed: jest.fn(),
            logInvitationCreationException: jest.fn(),
            logInvitationResent: jest.fn(),
            logInvitationResentException: jest.fn(),
            logInvitationCancelled: jest.fn(),
            logInvitationCancelledException: jest.fn(),
            logInvitationReissued: jest.fn(),
            logInvitationReissuedException: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<InvitationsService>(InvitationsService);

    // Reset mocks but preserve config service (plain function, not jest.fn)
    jest.clearAllMocks();
    mockEmailService.send.mockResolvedValue({ id: 'email-id' });

    // Default Clerk mock behavior
    mockClerkManagement.createInvitation.mockResolvedValue({
      id: 'clerk_inv_new',
      url: 'https://accounts.klivo.app/accept?__clerk_ticket=abc123',
    });
    mockClerkManagement.revokeInvitation.mockResolvedValue(undefined);

    // Default prisma update mock (for clerkInvitationId updates)
    mockPrisma.userInvitation.update.mockImplementation(
      async ({ data }: { where: { id: string }; data: Record<string, unknown> }) => ({
        ...mockInvitation,
        ...data,
      }),
    );
  });

  describe('create', () => {
    const createDto = {
      email: 'new@example.com',
      role: Role.CLIENT,
      organizationId: 'org-uuid-1',
    };

    it('should create an invitation with correct expiration', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.userInvitation.findFirst.mockResolvedValue(null);
      mockPrisma.userInvitation.create.mockResolvedValue(mockInvitation);

      const result = await service.create(createDto, 'user-uuid-1');

      expect(result).toEqual(mockInvitation);
      expect(mockPrisma.userInvitation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'new@example.com',
          role: Role.CLIENT,
          organizationId: 'org-uuid-1',
          invitedBy: 'user-uuid-1',
        }),
      });

      // Verify expiration is ~7 days from now
      const createCall = mockPrisma.userInvitation.create.mock.calls[0][0];
      const expiresAt = createCall.data.expiresAt as Date;
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + sevenDaysMs - 5000);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + sevenDaysMs + 5000);
    });

    it('should normalize email to lowercase', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.userInvitation.findFirst.mockResolvedValue(null);
      mockPrisma.userInvitation.create.mockResolvedValue(mockInvitation);

      await service.create(
        { ...createDto, email: 'NEW@EXAMPLE.COM' },
        'user-uuid-1',
      );

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'new@example.com' },
      });
      expect(mockPrisma.userInvitation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ email: 'new@example.com' }),
      });
    });

    it('should reject if user already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expect(
        service.create(createDto, 'user-uuid-1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create(createDto, 'user-uuid-1'),
      ).rejects.toThrow('User with this email already exists');
    });

    it('should reject if pending invitation already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.userInvitation.findFirst.mockResolvedValue(mockInvitation);

      await expect(
        service.create(createDto, 'user-uuid-1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create(createDto, 'user-uuid-1'),
      ).rejects.toThrow('Pending invitation already exists for this email');
    });

    it('should handle P2002 unique constraint violation', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.userInvitation.findFirst.mockResolvedValue(null);
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '6.0.0' },
      );
      mockPrisma.userInvitation.create.mockRejectedValue(p2002Error);

      await expect(
        service.create(createDto, 'user-uuid-1'),
      ).rejects.toThrow(
        new BadRequestException(
          'Pending invitation already exists for this email',
        ),
      );
    });

    it('should send invitation email after creation', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.userInvitation.findFirst.mockResolvedValue(null);
      mockPrisma.userInvitation.create.mockResolvedValue(mockInvitation);

      await service.create(createDto, 'user-uuid-1');

      // The body now comes from the DB-backed TEAM_INVITATION template, so the
      // assertion is on the variables handed to the renderer rather than on
      // inline HTML (which the founders can now edit at will).
      expect(mockEmailTemplates.render).toHaveBeenCalledWith(
        'TEAM_INVITATION',
        expect.objectContaining({
          orgName: 'Test Org',
          actionLabel: 'Set Your Password',
          expiresIn: '7 days',
        }),
      );
      expect(mockEmailService.send).toHaveBeenCalledWith({
        to: mockInvitation.email,
        subject: 'You have been invited to Klivo',
        html: '<p>invite</p>',
        text: 'invite',
        tags: { type: 'TEAM_INVITATION' },
      });
    });

    it('falls back to the product name when the invite has no organization', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.userInvitation.findFirst.mockResolvedValue(null);
      mockPrisma.userInvitation.create.mockResolvedValue({
        ...mockInvitation,
        organizationId: null,
      });

      await service.create(createDto, 'user-uuid-1');

      expect(mockPrisma.organization.findUnique).not.toHaveBeenCalled();
      expect(mockEmailTemplates.render).toHaveBeenCalledWith(
        'TEAM_INVITATION',
        expect.objectContaining({ orgName: 'Klivo' }),
      );
    });

    // An invitation is already persisted (and created in Clerk) by this point —
    // a template/mail problem must not roll it back.
    it('still creates the invitation when the email render fails', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.userInvitation.findFirst.mockResolvedValue(null);
      mockPrisma.userInvitation.create.mockResolvedValue(mockInvitation);
      mockEmailTemplates.render.mockRejectedValue(new Error('template missing'));

      const result = await service.create(createDto, 'user-uuid-1');

      expect(result).toEqual(mockInvitation);
      expect(mockEmailService.send).not.toHaveBeenCalled();
    });

    it('should create a Clerk invitation and store its id on create', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.userInvitation.findFirst.mockResolvedValue(null);
      mockPrisma.userInvitation.create.mockResolvedValue(mockInvitation);

      await service.create(createDto, 'user-uuid-1');

      expect(mockClerkManagement.createInvitation).toHaveBeenCalledWith({
        email: 'new@example.com',
        redirectUrl: 'http://localhost:3000/sign-up',
        expiresInDays: 7,
      });
      // Fresh invitation has no prior Clerk invitation → nothing to revoke
      expect(mockClerkManagement.revokeInvitation).not.toHaveBeenCalled();
      // Should store the Clerk invitation id on the invitation row
      expect(mockPrisma.userInvitation.update).toHaveBeenCalledWith({
        where: { id: mockInvitation.id },
        data: { clerkInvitationId: 'clerk_inv_new' },
      });
    });

    it('should handle Clerk failure gracefully on create', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.userInvitation.findFirst.mockResolvedValue(null);
      mockPrisma.userInvitation.create.mockResolvedValue(mockInvitation);
      mockClerkManagement.createInvitation.mockRejectedValue(
        new Error('Clerk API down'),
      );

      // Should not throw — invitation is still created
      const result = await service.create(createDto, 'user-uuid-1');

      expect(result).toEqual(mockInvitation);
      // Email still sent, with the fallback signup URL + label.
      expect(mockEmailTemplates.render).toHaveBeenCalledWith(
        'TEAM_INVITATION',
        expect.objectContaining({
          actionLabel: 'Create Your Account',
          actionUrl: expect.stringContaining('/signup?token='),
        }),
      );
      expect(mockEmailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: mockInvitation.email }),
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated invitations with defaults', async () => {
      const invitations = [mockInvitation];
      mockPrisma.userInvitation.findMany.mockResolvedValue(invitations);
      mockPrisma.userInvitation.count.mockResolvedValue(1);

      const result = await service.findAll();

      expect(result).toEqual({
        data: invitations,
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });
      expect(mockPrisma.userInvitation.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
      expect(mockPrisma.userInvitation.count).toHaveBeenCalledWith({ where: {} });
    });

    it('should apply search filter on email', async () => {
      mockPrisma.userInvitation.findMany.mockResolvedValue([]);
      mockPrisma.userInvitation.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 10, search: 'test@', sortBy: 'createdAt', sortOrder: 'desc' });

      const expectedWhere = { email: { contains: 'test@', mode: 'insensitive' } };
      expect(mockPrisma.userInvitation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(mockPrisma.userInvitation.count).toHaveBeenCalledWith({ where: expectedWhere });
    });

    it('should apply status filter (single value translates to IN clause)', async () => {
      mockPrisma.userInvitation.findMany.mockResolvedValue([]);
      mockPrisma.userInvitation.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 10, status: InvitationStatus.PENDING, sortBy: 'createdAt', sortOrder: 'desc' });

      // Single + multi status filters share one `IN (...)` query path.
      const expectedWhere = { status: { in: [InvitationStatus.PENDING] } };
      expect(mockPrisma.userInvitation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
    });

    it('should apply multi-status filter via statuses array', async () => {
      mockPrisma.userInvitation.findMany.mockResolvedValue([]);
      mockPrisma.userInvitation.count.mockResolvedValue(0);

      await service.findAll({
        page: 1, limit: 10,
        statuses: [InvitationStatus.PENDING, InvitationStatus.EXPIRED],
        sortBy: 'createdAt', sortOrder: 'desc',
      });

      const expectedWhere = {
        status: { in: [InvitationStatus.PENDING, InvitationStatus.EXPIRED] },
      };
      expect(mockPrisma.userInvitation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
    });

    it('should apply both search and status filters', async () => {
      mockPrisma.userInvitation.findMany.mockResolvedValue([]);
      mockPrisma.userInvitation.count.mockResolvedValue(0);

      await service.findAll({
        page: 1, limit: 10, search: 'admin', status: InvitationStatus.EXPIRED,
        sortBy: 'createdAt', sortOrder: 'desc',
      });

      const expectedWhere = {
        email: { contains: 'admin', mode: 'insensitive' },
        status: { in: [InvitationStatus.EXPIRED] },
      };
      expect(mockPrisma.userInvitation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
    });

    it('should handle pagination correctly', async () => {
      mockPrisma.userInvitation.findMany.mockResolvedValue([]);
      mockPrisma.userInvitation.count.mockResolvedValue(25);

      const result = await service.findAll({ page: 2, limit: 10, sortBy: 'createdAt', sortOrder: 'desc' });

      expect(result.meta).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3 });
      expect(mockPrisma.userInvitation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });

    it('should apply sorting', async () => {
      mockPrisma.userInvitation.findMany.mockResolvedValue([]);
      mockPrisma.userInvitation.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 10, sortBy: 'email', sortOrder: 'asc' });

      expect(mockPrisma.userInvitation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { email: 'asc' } }),
      );
    });
  });

  describe('findById', () => {
    it('should return invitation by id', async () => {
      mockPrisma.userInvitation.findUnique.mockResolvedValue(mockInvitation);

      const result = await service.findById('inv-uuid-1');

      expect(result).toEqual(mockInvitation);
    });

    it('should throw NotFoundException if not found', async () => {
      mockPrisma.userInvitation.findUnique.mockResolvedValue(null);

      await expect(service.findById('not-found')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('resend', () => {
    it('should resend a pending invitation with updated expiration', async () => {
      mockPrisma.userInvitation.findUnique.mockResolvedValue(mockInvitation);
      const updatedInvitation = { ...mockInvitation };
      mockPrisma.userInvitation.update.mockResolvedValueOnce(updatedInvitation);

      const result = await service.resend('inv-uuid-1');

      expect(result).toEqual(updatedInvitation);
      expect(mockPrisma.userInvitation.update).toHaveBeenCalledWith({
        where: { id: 'inv-uuid-1' },
        data: { expiresAt: expect.any(Date) },
      });
      expect(mockEmailService.send).toHaveBeenCalled();
    });

    it('should throw NotFoundException if invitation not found', async () => {
      mockPrisma.userInvitation.findUnique.mockResolvedValue(null);

      await expect(service.resend('not-found')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should reject resend for non-pending invitations', async () => {
      mockPrisma.userInvitation.findUnique.mockResolvedValue({
        ...mockInvitation,
        status: InvitationStatus.ACCEPTED,
      });

      await expect(service.resend('inv-uuid-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.resend('inv-uuid-1')).rejects.toThrow(
        'Can only resend pending invitations',
      );
    });

    it('should generate a fresh Clerk ticket on resend', async () => {
      const invitationWithClerk = {
        ...mockInvitation,
        clerkInvitationId: 'clerk_inv_old',
      };
      mockPrisma.userInvitation.findUnique.mockResolvedValue(invitationWithClerk);
      mockPrisma.userInvitation.update.mockResolvedValueOnce(invitationWithClerk);

      await service.resend('inv-uuid-1');

      // Stale Clerk invitation revoked, fresh one issued
      expect(mockClerkManagement.revokeInvitation).toHaveBeenCalledWith(
        'clerk_inv_old',
      );
      expect(mockClerkManagement.createInvitation).toHaveBeenCalled();
      expect(mockEmailTemplates.render).toHaveBeenCalledWith(
        'TEAM_INVITATION',
        expect.objectContaining({ actionLabel: 'Set Your Password' }),
      );
      expect(mockEmailService.send).toHaveBeenCalled();
    });
  });

  describe('reissue', () => {
    it('should reissue an expired invitation', async () => {
      const expiredInvitation = {
        ...mockInvitation,
        status: InvitationStatus.EXPIRED,
        expiresAt: new Date(Date.now() - 1000),
        reissueCount: 0,
      };
      mockPrisma.userInvitation.findUnique.mockResolvedValue(expiredInvitation);
      mockPrisma.userInvitation.update.mockResolvedValueOnce({
        ...expiredInvitation,
        status: InvitationStatus.PENDING,
        reissueCount: 1,
      });

      const result = await service.reissue('reissue-uuid-1');

      expect(result).toEqual({ message: 'Invitation reissued successfully' });
      expect(mockPrisma.userInvitation.update).toHaveBeenCalledWith({
        where: { id: mockInvitation.id },
        data: {
          token: expect.any(String),
          status: InvitationStatus.PENDING,
          reissueCount: { increment: 1 },
          expiresAt: expect.any(Date),
        },
      });
    });

    it('should throw NotFoundException for invalid reissue token', async () => {
      mockPrisma.userInvitation.findUnique.mockResolvedValue(null);

      await expect(service.reissue('bad-token')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.reissue('bad-token')).rejects.toThrow(
        'Invalid reissue token',
      );
    });

    it('should reject reissue for accepted invitations', async () => {
      mockPrisma.userInvitation.findUnique.mockResolvedValue({
        ...mockInvitation,
        status: InvitationStatus.ACCEPTED,
      });

      await expect(service.reissue('reissue-uuid-1')).rejects.toThrow(
        new BadRequestException('Invitation already accepted'),
      );
    });

    it('should reject reissue for non-expired invitations', async () => {
      mockPrisma.userInvitation.findUnique.mockResolvedValue({
        ...mockInvitation,
        status: InvitationStatus.PENDING,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      await expect(service.reissue('reissue-uuid-1')).rejects.toThrow(
        new BadRequestException('Invitation is still valid'),
      );
    });

    it('should enforce maximum reissue count', async () => {
      mockPrisma.userInvitation.findUnique.mockResolvedValue({
        ...mockInvitation,
        status: InvitationStatus.EXPIRED,
        expiresAt: new Date(Date.now() - 1000),
        reissueCount: 5,
      });

      await expect(service.reissue('reissue-uuid-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.reissue('reissue-uuid-1')).rejects.toThrow(
        'Maximum reissue attempts reached',
      );
    });

    it('should send email after reissue', async () => {
      const expiredInvitation = {
        ...mockInvitation,
        status: InvitationStatus.EXPIRED,
        expiresAt: new Date(Date.now() - 1000),
        reissueCount: 2,
      };
      mockPrisma.userInvitation.findUnique.mockResolvedValue(expiredInvitation);
      mockPrisma.userInvitation.update.mockResolvedValueOnce({
        ...expiredInvitation,
        status: InvitationStatus.PENDING,
        reissueCount: 3,
      });

      await service.reissue('reissue-uuid-1');

      expect(mockEmailService.send).toHaveBeenCalled();
    });

    it('should generate a fresh Clerk ticket on reissue', async () => {
      const expiredInvitation = {
        ...mockInvitation,
        status: InvitationStatus.EXPIRED,
        expiresAt: new Date(Date.now() - 1000),
        reissueCount: 0,
        clerkInvitationId: 'clerk_inv_old',
      };
      mockPrisma.userInvitation.findUnique.mockResolvedValue(expiredInvitation);
      mockPrisma.userInvitation.update.mockResolvedValueOnce({
        ...expiredInvitation,
        status: InvitationStatus.PENDING,
        reissueCount: 1,
      });

      await service.reissue('reissue-uuid-1');

      expect(mockClerkManagement.revokeInvitation).toHaveBeenCalledWith(
        'clerk_inv_old',
      );
      expect(mockClerkManagement.createInvitation).toHaveBeenCalled();
    });
  });

  describe('validate', () => {
    it('should return invitation details for a valid token', async () => {
      mockPrisma.userInvitation.findUnique.mockResolvedValue(mockInvitation);

      const result = await service.validate('token-uuid-1');

      expect(result).toEqual({
        email: mockInvitation.email,
        organizationId: mockInvitation.organizationId,
        role: mockInvitation.role,
      });
      expect(mockPrisma.userInvitation.findUnique).toHaveBeenCalledWith({
        where: { token: 'token-uuid-1' },
      });
    });

    it('should throw NotFoundException for invalid token', async () => {
      mockPrisma.userInvitation.findUnique.mockResolvedValue(null);

      await expect(service.validate('bad-token')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.validate('bad-token')).rejects.toThrow(
        'Invalid invitation token',
      );
    });

    it('should throw BadRequestException for already-used invitation', async () => {
      mockPrisma.userInvitation.findUnique.mockResolvedValue({
        ...mockInvitation,
        status: InvitationStatus.ACCEPTED,
      });

      await expect(service.validate('token-uuid-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.validate('token-uuid-1')).rejects.toThrow(
        'Invitation has already been used',
      );
    });

    it('should throw BadRequestException for EXPIRED status invitation', async () => {
      mockPrisma.userInvitation.findUnique.mockResolvedValue({
        ...mockInvitation,
        status: InvitationStatus.EXPIRED,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // not yet expired by date
      });

      try {
        await service.validate('token-uuid-1');
        fail('Expected BadRequestException');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const response = (error as BadRequestException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            message: 'Invitation has expired',
            reissueToken: mockInvitation.reissueToken,
          }),
        );
      }
    });

    it('should throw BadRequestException with reissueToken for expired invitation', async () => {
      const expiredInvitation = {
        ...mockInvitation,
        expiresAt: new Date(Date.now() - 1000),
      };
      mockPrisma.userInvitation.findUnique.mockResolvedValue(expiredInvitation);

      try {
        await service.validate('token-uuid-1');
        fail('Expected BadRequestException');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const response = (error as BadRequestException).getResponse();
        expect(response).toEqual(
          expect.objectContaining({
            message: 'Invitation has expired',
            reissueToken: mockInvitation.reissueToken,
          }),
        );
      }
    });
  });

  describe('cancel', () => {
    it('should delete the invitation', async () => {
      mockPrisma.userInvitation.findUnique.mockResolvedValue(mockInvitation);
      mockPrisma.userInvitation.delete.mockResolvedValue(mockInvitation);

      const result = await service.cancel('inv-uuid-1');

      expect(result).toEqual(mockInvitation);
      expect(mockPrisma.userInvitation.delete).toHaveBeenCalledWith({
        where: { id: 'inv-uuid-1' },
      });
    });

    it('should throw NotFoundException if invitation not found', async () => {
      mockPrisma.userInvitation.findUnique.mockResolvedValue(null);

      await expect(service.cancel('not-found')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should reject cancellation of accepted invitations', async () => {
      mockPrisma.userInvitation.findUnique.mockResolvedValue({
        ...mockInvitation,
        status: InvitationStatus.ACCEPTED,
      });

      await expect(service.cancel('inv-uuid-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.cancel('inv-uuid-1')).rejects.toThrow(
        'Cannot cancel an accepted invitation',
      );
    });

    it('should revoke the Clerk invitation when cancelling one with clerkInvitationId', async () => {
      const invitationWithClerk = {
        ...mockInvitation,
        clerkInvitationId: 'clerk_inv_x',
      };
      mockPrisma.userInvitation.findUnique.mockResolvedValue(invitationWithClerk);
      mockPrisma.userInvitation.delete.mockResolvedValue(invitationWithClerk);

      await service.cancel('inv-uuid-1');

      expect(mockClerkManagement.revokeInvitation).toHaveBeenCalledWith(
        'clerk_inv_x',
      );
      expect(mockPrisma.userInvitation.delete).toHaveBeenCalledWith({
        where: { id: 'inv-uuid-1' },
      });
    });

    it('should not revoke a Clerk invitation when none was issued', async () => {
      mockPrisma.userInvitation.findUnique.mockResolvedValue(mockInvitation);
      mockPrisma.userInvitation.delete.mockResolvedValue(mockInvitation);

      await service.cancel('inv-uuid-1');

      expect(mockClerkManagement.revokeInvitation).not.toHaveBeenCalled();
    });

    it('should throw ServiceUnavailableException when Clerk revoke fails on cancel', async () => {
      const invitationWithClerk = {
        ...mockInvitation,
        clerkInvitationId: 'clerk_inv_x',
      };
      mockPrisma.userInvitation.findUnique.mockResolvedValue(invitationWithClerk);
      mockClerkManagement.revokeInvitation.mockRejectedValue(
        new Error('Clerk API down'),
      );

      // Should throw — invitation must NOT be deleted to preserve clerkInvitationId
      await expect(service.cancel('inv-uuid-1')).rejects.toThrow(
        'Failed to revoke Clerk invitation; invitation was not cancelled. Please retry.',
      );

      expect(mockPrisma.userInvitation.delete).not.toHaveBeenCalled();
    });
  });
});
