import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from '../../../src/services/users.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { Role } from '@prisma/client';

describe('UsersService', () => {
  let service: UsersService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockOrganization = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Test Organization',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUser = {
    id: '123e4567-e89b-12d3-a456-426614174001',
    email: 'test@example.com',
    name: 'Test User',
    role: Role.CLIENT,
    auth0Id: 'auth0|123456',
    organizationId: mockOrganization.id,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findByAuth0Id', () => {
    it('should find user by auth0Id and include organization', async () => {
      const userWithOrg = { ...mockUser, organization: mockOrganization };
      mockPrismaService.user.findUnique.mockResolvedValue(userWithOrg);

      const result = await service.findByAuth0Id('auth0|123456');

      expect(result).toEqual(userWithOrg);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { auth0Id: 'auth0|123456' },
        include: { organization: true },
      });
    });

    it('should return null when user is not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      const result = await service.findByAuth0Id('auth0|nonexistent');

      expect(result).toBeNull();
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { auth0Id: 'auth0|nonexistent' },
        include: { organization: true },
      });
    });
  });

  describe('findByEmail', () => {
    it('should find user by email', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findByEmail('test@example.com');

      expect(result).toEqual(mockUser);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
    });

    it('should return null when user is not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      const result = await service.findByEmail('nonexistent@example.com');

      expect(result).toBeNull();
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'nonexistent@example.com' },
      });
    });
  });

  describe('createFromAuth0', () => {
    it('should create user from Auth0 data with all fields', async () => {
      const createData = {
        auth0Id: 'auth0|123456',
        email: 'test@example.com',
        name: 'Test User',
        role: Role.CLIENT,
        organizationId: mockOrganization.id,
      };

      mockPrismaService.user.create.mockResolvedValue(mockUser);

      const result = await service.createFromAuth0(createData);

      expect(result).toEqual(mockUser);
      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: {
          auth0Id: createData.auth0Id,
          email: createData.email,
          name: createData.name,
          role: createData.role,
          organizationId: createData.organizationId,
        },
      });
    });

    it('should create user from Auth0 data without optional name', async () => {
      const createData = {
        auth0Id: 'auth0|123456',
        email: 'test@example.com',
        role: Role.CLIENT,
        organizationId: mockOrganization.id,
      };

      const userWithoutName = { ...mockUser, name: null };
      mockPrismaService.user.create.mockResolvedValue(userWithoutName);

      const result = await service.createFromAuth0(createData);

      expect(result).toEqual(userWithoutName);
      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: {
          auth0Id: createData.auth0Id,
          email: createData.email,
          name: undefined,
          role: createData.role,
          organizationId: createData.organizationId,
        },
      });
    });

    it('should create user with ADMIN role', async () => {
      const createData = {
        auth0Id: 'auth0|admin123',
        email: 'admin@example.com',
        name: 'Admin User',
        role: Role.ADMIN,
        organizationId: mockOrganization.id,
      };

      const adminUser = { ...mockUser, role: Role.ADMIN, email: 'admin@example.com' };
      mockPrismaService.user.create.mockResolvedValue(adminUser);

      const result = await service.createFromAuth0(createData);

      expect(result.role).toBe(Role.ADMIN);
      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: createData,
      });
    });

    it('should enforce unique email constraint', async () => {
      const createData = {
        auth0Id: 'auth0|456',
        email: 'test@example.com', // duplicate email
        role: Role.CLIENT,
        organizationId: mockOrganization.id,
      };

      mockPrismaService.user.create.mockRejectedValue(
        new Error('Unique constraint failed on the fields: (`email`)')
      );

      await expect(service.createFromAuth0(createData)).rejects.toThrow();
      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: {
          auth0Id: createData.auth0Id,
          email: createData.email,
          name: undefined,
          role: createData.role,
          organizationId: createData.organizationId,
        },
      });
    });

    it('should enforce unique auth0Id constraint', async () => {
      const createData = {
        auth0Id: 'auth0|123456', // duplicate auth0Id
        email: 'different@example.com',
        role: Role.CLIENT,
        organizationId: mockOrganization.id,
      };

      mockPrismaService.user.create.mockRejectedValue(
        new Error('Unique constraint failed on the fields: (`auth0Id`)')
      );

      await expect(service.createFromAuth0(createData)).rejects.toThrow();
    });
  });

  describe('updateProfile', () => {
    it('should update user profile with name', async () => {
      const updatedUser = { ...mockUser, name: 'Updated Name' };
      mockPrismaService.user.update.mockResolvedValue(updatedUser);

      const result = await service.updateProfile(mockUser.id, { name: 'Updated Name' });

      expect(result).toEqual(updatedUser);
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { name: 'Updated Name' },
      });
    });

    it('should update user profile with empty data object', async () => {
      mockPrismaService.user.update.mockResolvedValue(mockUser);

      const result = await service.updateProfile(mockUser.id, {});

      expect(result).toEqual(mockUser);
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: {},
      });
    });

    it('should throw error when updating non-existent user', async () => {
      mockPrismaService.user.update.mockRejectedValue(
        new Error('Record to update not found')
      );

      await expect(
        service.updateProfile('nonexistent-id', { name: 'New Name' })
      ).rejects.toThrow();
    });
  });

  describe('findByOrganization', () => {
    it('should find all users in an organization', async () => {
      const users = [
        mockUser,
        {
          ...mockUser,
          id: '123e4567-e89b-12d3-a456-426614174002',
          email: 'user2@example.com',
        },
      ];

      mockPrismaService.user.findMany.mockResolvedValue(users);

      const result = await service.findByOrganization(mockOrganization.id);

      expect(result).toEqual(users);
      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith({
        where: { organizationId: mockOrganization.id },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array when organization has no users', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([]);

      const result = await service.findByOrganization('empty-org-id');

      expect(result).toEqual([]);
      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'empty-org-id' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return users ordered by createdAt descending', async () => {
      const now = new Date();
      const user1 = { ...mockUser, createdAt: new Date(now.getTime() - 1000) };
      const user2 = { ...mockUser, createdAt: now, id: 'newer-user-id' };

      mockPrismaService.user.findMany.mockResolvedValue([user2, user1]);

      const result = await service.findByOrganization(mockOrganization.id);

      expect(result).toHaveLength(2);
      expect(result[0]?.createdAt).toEqual(now);
      expect(result[1]?.createdAt).toEqual(user1.createdAt);
    });
  });

  describe('organization relationship', () => {
    it('should enforce foreign key constraint to organization', async () => {
      const createData = {
        auth0Id: 'auth0|123456',
        email: 'test@example.com',
        role: Role.CLIENT,
        organizationId: 'nonexistent-org-id',
      };

      mockPrismaService.user.create.mockRejectedValue(
        new Error('Foreign key constraint failed on the field: `organizationId`')
      );

      await expect(service.createFromAuth0(createData)).rejects.toThrow();
    });
  });
});
