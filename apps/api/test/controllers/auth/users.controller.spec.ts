import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from '../../../src/controllers/auth/users.controller';
import { UsersService } from '../../../src/services/users.service';
import { CurrentUserData } from '../../../src/decorators/current-user.decorator';
import { Role } from '@prisma/client';

describe('UsersController', () => {
  let controller: UsersController;

  const mockUsersService = {
    findByAuth0Id: jest.fn(),
    updateProfile: jest.fn(),
  };

  const mockOrganization = {
    id: 'org-uuid',
    name: 'Test Org',
  };

  // After UserSyncInterceptor, user has full DB data
  const mockUser: CurrentUserData = {
    auth0Id: 'auth0|123456',
    email: 'test@example.com',
    roles: ['user'],
    id: 'user-uuid',
    role: Role.CLIENT,
    organizationId: 'org-uuid',
    organization: mockOrganization,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getProfile', () => {
    it('should return synced user profile from request', async () => {
      const result = await controller.getProfile(mockUser);

      expect(result).toEqual({
        id: 'user-uuid',
        email: 'test@example.com',
        role: Role.CLIENT,
        organizationId: 'org-uuid',
        organization: mockOrganization,
        roles: ['user'],
      });
    });

    it('should not call UsersService since user is already synced', async () => {
      await controller.getProfile(mockUser);

      expect(mockUsersService.findByAuth0Id).not.toHaveBeenCalled();
    });
  });

  describe('updateProfile', () => {
    it('should update user profile using synced user id', async () => {
      const updatedUser = {
        id: 'user-uuid',
        email: 'test@example.com',
        name: 'Updated Name',
        role: Role.CLIENT,
        auth0Id: 'auth0|123456',
        organizationId: 'org-uuid',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockUsersService.updateProfile.mockResolvedValue(updatedUser);

      const result = await controller.updateProfile(mockUser, {
        name: 'Updated Name',
      });

      expect(mockUsersService.updateProfile).toHaveBeenCalledWith(
        'user-uuid',
        { name: 'Updated Name' },
      );
      expect(result).toEqual(updatedUser);
    });

    it('should not need to look up user by auth0Id', async () => {
      mockUsersService.updateProfile.mockResolvedValue({});

      await controller.updateProfile(mockUser, { name: 'New Name' });

      expect(mockUsersService.findByAuth0Id).not.toHaveBeenCalled();
    });
  });
});
