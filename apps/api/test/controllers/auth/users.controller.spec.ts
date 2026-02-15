import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from '../../../src/controllers/auth/users.controller';
import { UsersService } from '../../../src/services/users.service';
import { CurrentUserData } from '../../../src/decorators/current-user.decorator';
import { Role } from '@prisma/client';

describe('UsersController', () => {
  let controller: UsersController;

  const mockUsersService = {
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
  };

  const mockOrganization = {
    id: 'org-uuid',
    name: 'Test Org',
    slug: 'test-org',
  };

  const mockUser: CurrentUserData = {
    auth0Id: 'auth0|123456',
    email: 'test@example.com',
    roles: ['user'],
    id: 'user-uuid',
    role: Role.CLIENT,
    organizationId: 'org-uuid',
    organization: mockOrganization,
  };

  const mockProfileResponse = {
    id: 'user-uuid',
    email: 'test@example.com',
    name: 'Test User',
    role: Role.CLIENT,
    organization: mockOrganization,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
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
    it('should call usersService.getProfile with user id', async () => {
      mockUsersService.getProfile.mockResolvedValue(mockProfileResponse);

      const result = await controller.getProfile(mockUser);

      expect(mockUsersService.getProfile).toHaveBeenCalledWith('user-uuid');
      expect(result).toEqual(mockProfileResponse);
    });

    it('should return profile with null organization for SUPER_ADMIN', async () => {
      const superAdminUser: CurrentUserData = {
        auth0Id: 'auth0|superadmin',
        email: 'admin@codeweaves.com',
        roles: ['SUPER_ADMIN'],
        id: 'superadmin-uuid',
        role: Role.SUPER_ADMIN,
        organizationId: null,
        organization: null,
      };
      const superAdminProfile = {
        id: 'superadmin-uuid',
        email: 'admin@codeweaves.com',
        name: 'Super Admin',
        role: Role.SUPER_ADMIN,
        organization: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      };
      mockUsersService.getProfile.mockResolvedValue(superAdminProfile);

      const result = await controller.getProfile(superAdminUser);

      expect(result.organization).toBeNull();
      expect(mockUsersService.getProfile).toHaveBeenCalledWith('superadmin-uuid');
    });

    it('should return profile with organization details', async () => {
      mockUsersService.getProfile.mockResolvedValue(mockProfileResponse);

      const result = await controller.getProfile(mockUser);

      expect(result.organization).toEqual(mockOrganization);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });
  });

  describe('updateProfile', () => {
    it('should update user profile with name', async () => {
      const updatedProfile = {
        ...mockProfileResponse,
        name: 'Updated Name',
        updatedAt: new Date('2026-01-02'),
      };
      mockUsersService.updateProfile.mockResolvedValue(updatedProfile);

      const result = await controller.updateProfile(mockUser, {
        name: 'Updated Name',
      });

      expect(mockUsersService.updateProfile).toHaveBeenCalledWith(
        'user-uuid',
        { name: 'Updated Name' },
      );
      expect(result).toEqual(updatedProfile);
    });

    it('should update profile with empty data object', async () => {
      mockUsersService.updateProfile.mockResolvedValue(mockProfileResponse);

      const result = await controller.updateProfile(mockUser, {});

      expect(mockUsersService.updateProfile).toHaveBeenCalledWith(
        'user-uuid',
        {},
      );
      expect(result).toEqual(mockProfileResponse);
    });

    it('should not need to look up user by auth0Id', async () => {
      mockUsersService.updateProfile.mockResolvedValue(mockProfileResponse);

      await controller.updateProfile(mockUser, { name: 'New Name' });

      expect(mockUsersService.getProfile).not.toHaveBeenCalled();
    });
  });
});
