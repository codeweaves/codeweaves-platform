import { Test, TestingModule } from '@nestjs/testing';
import { InvitationsController } from '../../../src/controllers/invitations/invitations.controller';
import { InvitationsService } from '../../../src/services/invitations.service';
import { CurrentUserData } from '../../../src/decorators/current-user.decorator';
import { InvitationStatus, Role } from '@prisma/client';

describe('InvitationsController', () => {
  let controller: InvitationsController;

  const mockInvitationsService = {
    create: jest.fn(),
    validate: jest.fn(),
    findAll: jest.fn(),
    findById: jest.fn(),
    resend: jest.fn(),
    reissue: jest.fn(),
    cancel: jest.fn(),
  };

  const mockUser: CurrentUserData = {
    clerkId: 'user_admin',
    email: 'admin@example.com',
    id: 'user-uuid-1',
    role: Role.SUPER_ADMIN,
    organizationId: 'org-uuid-1',
    organization: { id: 'org-uuid-1', name: 'Test Org', slug: 'test-org' },
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
      controllers: [InvitationsController],
      providers: [
        { provide: InvitationsService, useValue: mockInvitationsService },
      ],
    }).compile();

    controller = module.get<InvitationsController>(InvitationsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create an invitation', async () => {
      const dto = {
        email: 'new@example.com',
        role: Role.CLIENT,
        organizationId: 'org-uuid-1',
      };
      mockInvitationsService.create.mockResolvedValue(mockInvitation);

      const result = await controller.create(dto, mockUser);

      expect(result).toEqual(mockInvitation);
      expect(mockInvitationsService.create).toHaveBeenCalledWith(
        dto,
        mockUser.id,
      );
    });
  });

  describe('validate', () => {
    it('should validate an invitation token', async () => {
      const validationResult = {
        email: 'new@example.com',
        organizationId: 'org-uuid-1',
        role: Role.CLIENT,
      };
      mockInvitationsService.validate.mockResolvedValue(validationResult);

      const result = await controller.validate('token-uuid-1');

      expect(result).toEqual(validationResult);
      expect(mockInvitationsService.validate).toHaveBeenCalledWith(
        'token-uuid-1',
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated invitations', async () => {
      const paginatedResult = {
        data: [mockInvitation],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      };
      mockInvitationsService.findAll.mockResolvedValue(paginatedResult);

      const query = { page: 1, limit: 20, sortBy: 'createdAt' as const, sortOrder: 'desc' as const };
      const result = await controller.findAll(query);

      expect(result).toEqual(paginatedResult);
      expect(mockInvitationsService.findAll).toHaveBeenCalledWith(query);
    });

    it('should pass search and status filters to service', async () => {
      const paginatedResult = {
        data: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      };
      mockInvitationsService.findAll.mockResolvedValue(paginatedResult);

      const query = {
        page: 1, limit: 10, search: 'test@', status: 'PENDING' as const,
        sortBy: 'email' as const, sortOrder: 'asc' as const,
      };
      const result = await controller.findAll(query);

      expect(result).toEqual(paginatedResult);
      expect(mockInvitationsService.findAll).toHaveBeenCalledWith(query);
    });
  });

  describe('findById', () => {
    it('should return invitation by id', async () => {
      mockInvitationsService.findById.mockResolvedValue(mockInvitation);

      const result = await controller.findById('inv-uuid-1');

      expect(result).toEqual(mockInvitation);
      expect(mockInvitationsService.findById).toHaveBeenCalledWith(
        'inv-uuid-1',
      );
    });
  });

  describe('resend', () => {
    it('should resend an invitation', async () => {
      mockInvitationsService.resend.mockResolvedValue(mockInvitation);

      const result = await controller.resend('inv-uuid-1');

      expect(result).toEqual(mockInvitation);
      expect(mockInvitationsService.resend).toHaveBeenCalledWith('inv-uuid-1');
    });
  });

  describe('cancel', () => {
    it('should cancel an invitation', async () => {
      mockInvitationsService.cancel.mockResolvedValue(mockInvitation);

      const result = await controller.cancel('inv-uuid-1');

      expect(result).toEqual(mockInvitation);
      expect(mockInvitationsService.cancel).toHaveBeenCalledWith('inv-uuid-1');
    });
  });

  describe('reissue', () => {
    it('should reissue an invitation', async () => {
      const dto = { reissueToken: 'reissue-uuid-1' };
      mockInvitationsService.reissue.mockResolvedValue({
        message: 'Invitation reissued successfully',
      });

      const result = await controller.reissue(dto);

      expect(result).toEqual({ message: 'Invitation reissued successfully' });
      expect(mockInvitationsService.reissue).toHaveBeenCalledWith(
        'reissue-uuid-1',
      );
    });
  });

  describe('role authorization metadata', () => {
    it('should have SUPER_ADMIN role metadata on create endpoint', () => {
      const metadata = Reflect.getMetadata(
        'roles',
        InvitationsController.prototype.create,
      );
      expect(metadata).toEqual([Role.SUPER_ADMIN]);
    });

    it('should have SUPER_ADMIN and ADMIN role metadata on findAll endpoint', () => {
      const metadata = Reflect.getMetadata(
        'roles',
        InvitationsController.prototype.findAll,
      );
      expect(metadata).toEqual([Role.SUPER_ADMIN, Role.ADMIN]);
    });

    it('should have SUPER_ADMIN role metadata on findById endpoint', () => {
      const metadata = Reflect.getMetadata(
        'roles',
        InvitationsController.prototype.findById,
      );
      expect(metadata).toEqual([Role.SUPER_ADMIN]);
    });

    it('should have SUPER_ADMIN role metadata on resend endpoint', () => {
      const metadata = Reflect.getMetadata(
        'roles',
        InvitationsController.prototype.resend,
      );
      expect(metadata).toEqual([Role.SUPER_ADMIN]);
    });

    it('should have SUPER_ADMIN role metadata on cancel endpoint', () => {
      const metadata = Reflect.getMetadata(
        'roles',
        InvitationsController.prototype.cancel,
      );
      expect(metadata).toEqual([Role.SUPER_ADMIN]);
    });

    it('should NOT have role metadata on validate (public endpoint)', () => {
      const metadata = Reflect.getMetadata(
        'roles',
        InvitationsController.prototype.validate,
      );
      expect(metadata).toBeUndefined();
    });

    it('should NOT have role metadata on reissue (public endpoint)', () => {
      const metadata = Reflect.getMetadata(
        'roles',
        InvitationsController.prototype.reissue,
      );
      expect(metadata).toBeUndefined();
    });
  });
});
