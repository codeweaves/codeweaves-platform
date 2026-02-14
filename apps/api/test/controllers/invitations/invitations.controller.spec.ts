import { Test, TestingModule } from '@nestjs/testing';
import { InvitationsController } from '../../../src/controllers/invitations/invitations.controller';
import { InvitationsService } from '../../../src/services/invitations.service';
import { CurrentUserData } from '../../../src/decorators/current-user.decorator';
import { InvitationStatus, Role } from '@prisma/client';

describe('InvitationsController', () => {
  let controller: InvitationsController;

  const mockInvitationsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findById: jest.fn(),
    resend: jest.fn(),
    reissue: jest.fn(),
    cancel: jest.fn(),
  };

  const mockUser: CurrentUserData = {
    auth0Id: 'auth0|admin',
    email: 'admin@example.com',
    roles: ['SUPER_ADMIN'],
    id: 'user-uuid-1',
    role: Role.SUPER_ADMIN,
    organizationId: 'org-uuid-1',
    organization: { id: 'org-uuid-1', name: 'Test Org' },
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

  describe('findAll', () => {
    it('should return all invitations for the organization', async () => {
      mockInvitationsService.findAll.mockResolvedValue([mockInvitation]);

      const result = await controller.findAll();

      expect(result).toEqual([mockInvitation]);
      expect(mockInvitationsService.findAll).toHaveBeenCalled();
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
});
