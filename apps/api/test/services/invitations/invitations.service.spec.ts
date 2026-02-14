import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvitationsService } from '../../../src/services/invitations.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { EmailService } from '../../../src/services/email.service';
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
    },
  };

  const mockEmailService = {
    send: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const config: Record<string, string> = {
        DASHBOARD_URL: 'http://localhost:3000',
      };
      return config[key] ?? defaultValue;
    }),
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
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<InvitationsService>(InvitationsService);
    jest.clearAllMocks();
    mockEmailService.send.mockResolvedValue({ id: 'email-id' });
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

      expect(mockEmailService.send).toHaveBeenCalledWith({
        to: mockInvitation.email,
        subject: 'You have been invited to CodeWeaves',
        html: expect.stringContaining(mockInvitation.token),
      });
    });
  });

  describe('findAll', () => {
    it('should return all invitations', async () => {
      const invitations = [mockInvitation];
      mockPrisma.userInvitation.findMany.mockResolvedValue(invitations);

      const result = await service.findAll();

      expect(result).toEqual(invitations);
      expect(mockPrisma.userInvitation.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
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
      mockPrisma.userInvitation.update.mockResolvedValue(updatedInvitation);

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
      mockPrisma.userInvitation.update.mockResolvedValue({
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
      mockPrisma.userInvitation.update.mockResolvedValue({
        ...expiredInvitation,
        status: InvitationStatus.PENDING,
        reissueCount: 3,
      });

      await service.reissue('reissue-uuid-1');

      expect(mockEmailService.send).toHaveBeenCalled();
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
  });
});
