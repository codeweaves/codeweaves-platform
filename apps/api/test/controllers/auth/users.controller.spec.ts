import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
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

  const mockUser: CurrentUserData = {
    auth0Id: 'auth0|123456',
    email: 'test@example.com',
    roles: ['user'],
  };

  const mockDbUser = {
    id: 'user-uuid',
    email: 'test@example.com',
    name: 'Test User',
    role: Role.CLIENT,
    auth0Id: 'auth0|123456',
    organizationId: 'org-uuid',
    createdAt: new Date(),
    updatedAt: new Date(),
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
    it('should return user profile when user exists in database', async () => {
      mockUsersService.findByAuth0Id.mockResolvedValue(mockDbUser);

      const result = await controller.getProfile(mockUser);

      expect(mockUsersService.findByAuth0Id).toHaveBeenCalledWith('auth0|123456');
      expect(result).toEqual({
        id: mockDbUser.id,
        email: mockDbUser.email,
        name: mockDbUser.name,
        role: mockDbUser.role,
        organizationId: mockDbUser.organizationId,
        roles: ['user'],
        synced: true,
      });
    });

    it('should return partial profile when user not in database', async () => {
      mockUsersService.findByAuth0Id.mockResolvedValue(null);

      const result = await controller.getProfile(mockUser);

      expect(mockUsersService.findByAuth0Id).toHaveBeenCalledWith('auth0|123456');
      expect(result).toEqual({
        auth0Id: 'auth0|123456',
        email: 'test@example.com',
        roles: ['user'],
        synced: false,
      });
    });
  });

  describe('updateProfile', () => {
    it('should update user profile successfully', async () => {
      const updatedUser = { ...mockDbUser, name: 'Updated Name' };
      mockUsersService.findByAuth0Id.mockResolvedValue(mockDbUser);
      mockUsersService.updateProfile.mockResolvedValue(updatedUser);

      const result = await controller.updateProfile(mockUser, { name: 'Updated Name' });

      expect(mockUsersService.findByAuth0Id).toHaveBeenCalledWith('auth0|123456');
      expect(mockUsersService.updateProfile).toHaveBeenCalledWith('user-uuid', { name: 'Updated Name' });
      expect(result).toEqual(updatedUser);
    });

    it('should throw NotFoundException when user not found in database', async () => {
      mockUsersService.findByAuth0Id.mockResolvedValue(null);

      await expect(controller.updateProfile(mockUser, { name: 'New Name' })).rejects.toThrow(NotFoundException);
    });
  });
});
