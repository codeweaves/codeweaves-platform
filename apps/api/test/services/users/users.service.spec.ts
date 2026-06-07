import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../../../src/services/users.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { UserLoggerService } from '../../../src/common/logger/user.logger';
import { Role, InvitationStatus, Prisma } from '@prisma/client';

describe('UsersService', () => {
  let service: UsersService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    userInvitation: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockOrganization = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Test Organization',
    slug: 'test-organization',
  };

  const mockUser = {
    id: '123e4567-e89b-12d3-a456-426614174001',
    email: 'test@example.com',
    name: 'Test User',
    role: Role.CLIENT,
    clerkId: 'user_123456',
    organizationId: mockOrganization.id,
    organization: mockOrganization,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const mockSuperAdmin = {
    id: '123e4567-e89b-12d3-a456-426614174099',
    email: 'admin@codeweaves.com',
    name: 'Super Admin',
    role: Role.SUPER_ADMIN,
    clerkId: 'user_superadmin',
    organizationId: null,
    organization: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const userWithOrgInclude = {
    include: {
      organization: {
        select: { id: true, name: true, slug: true },
      },
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: UserLoggerService,
          useValue: {
            logUserCreatedFromAuth0: jest.fn(),
            logUserCreatedFromInvitation: jest.fn(),
            logUserCreationException: jest.fn(),
            logUserProfileUpdated: jest.fn(),
            logUserProfileUpdateException: jest.fn(),
            logUserFirstLogin: jest.fn(),
            logMemberAssigned: jest.fn(),
            logMemberRemoved: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findByClerkId', () => {
    it('should find active user by clerkId and include organization', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(mockUser);

      const result = await service.findByClerkId('user_123456');

      expect(result).toEqual(mockUser);
      expect(mockPrismaService.user.findFirst).toHaveBeenCalledWith({
        where: { clerkId: 'user_123456', deletedAt: null },
        include: { organization: true },
      });
    });

    it('should return null when user is not found', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);

      const result = await service.findByClerkId('user_nonexistent');

      expect(result).toBeNull();
      expect(mockPrismaService.user.findFirst).toHaveBeenCalledWith({
        where: { clerkId: 'user_nonexistent', deletedAt: null },
        include: { organization: true },
      });
    });

    it('should exclude soft-deleted users', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);

      const result = await service.findByClerkId('user_deleted');

      expect(result).toBeNull();
      expect(mockPrismaService.user.findFirst).toHaveBeenCalledWith({
        where: { clerkId: 'user_deleted', deletedAt: null },
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

  describe('createFromClerk', () => {
    it('should create user from Auth0 data with all fields', async () => {
      const createData = {
        clerkId: 'user_123456',
        email: 'test@example.com',
        name: 'Test User',
        role: Role.CLIENT,
        organizationId: mockOrganization.id,
      };

      mockPrismaService.user.create.mockResolvedValue(mockUser);

      const result = await service.createFromClerk(createData);

      expect(result).toEqual(mockUser);
      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: {
          clerkId: createData.clerkId,
          email: createData.email,
          name: createData.name,
          role: createData.role,
          organizationId: createData.organizationId,
        },
      });
    });

    it('should create user from Auth0 data without optional name', async () => {
      const createData = {
        clerkId: 'user_123456',
        email: 'test@example.com',
        role: Role.CLIENT,
        organizationId: mockOrganization.id,
      };

      const userWithoutName = { ...mockUser, name: null };
      mockPrismaService.user.create.mockResolvedValue(userWithoutName);

      const result = await service.createFromClerk(createData);

      expect(result).toEqual(userWithoutName);
      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: {
          clerkId: createData.clerkId,
          email: createData.email,
          name: undefined,
          role: createData.role,
          organizationId: createData.organizationId,
        },
      });
    });

    it('should create user with ADMIN role', async () => {
      const createData = {
        clerkId: 'user_admin123',
        email: 'admin@example.com',
        name: 'Admin User',
        role: Role.ADMIN,
        organizationId: mockOrganization.id,
      };

      const adminUser = { ...mockUser, role: Role.ADMIN, email: 'admin@example.com' };
      mockPrismaService.user.create.mockResolvedValue(adminUser);

      const result = await service.createFromClerk(createData);

      expect(result.role).toBe(Role.ADMIN);
      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: createData,
      });
    });

    it('should create SUPER_ADMIN without organizationId', async () => {
      const createData = {
        clerkId: 'user_superadmin',
        email: 'admin@codeweaves.com',
        name: 'Super Admin',
        role: Role.SUPER_ADMIN,
      };

      mockPrismaService.user.create.mockResolvedValue(mockSuperAdmin);

      const result = await service.createFromClerk(createData);

      expect(result).toEqual(mockSuperAdmin);
      expect(result.organizationId).toBeNull();
      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: {
          clerkId: createData.clerkId,
          email: createData.email,
          name: createData.name,
          role: createData.role,
          organizationId: undefined,
        },
      });
    });

    it('should enforce unique email constraint', async () => {
      const createData = {
        clerkId: 'user_456',
        email: 'test@example.com',
        role: Role.CLIENT,
        organizationId: mockOrganization.id,
      };

      mockPrismaService.user.create.mockRejectedValue(
        new Error('Unique constraint failed on the fields: (`email`)'),
      );

      await expect(service.createFromClerk(createData)).rejects.toThrow();
      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: {
          clerkId: createData.clerkId,
          email: createData.email,
          name: undefined,
          role: createData.role,
          organizationId: createData.organizationId,
        },
      });
    });

    it('should enforce unique clerkId constraint', async () => {
      const createData = {
        clerkId: 'user_123456',
        email: 'different@example.com',
        role: Role.CLIENT,
        organizationId: mockOrganization.id,
      };

      mockPrismaService.user.create.mockRejectedValue(
        new Error('Unique constraint failed on the fields: (`clerkId`)'),
      );

      await expect(service.createFromClerk(createData)).rejects.toThrow();
    });
  });

  describe('getProfile', () => {
    it('should return user profile with organization details', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getProfile(mockUser.id);

      expect(result).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        role: mockUser.role,
        organization: mockOrganization,
        createdAt: mockUser.createdAt,
        updatedAt: mockUser.updatedAt,
      });
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        ...userWithOrgInclude,
      });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getProfile('nonexistent-id')).rejects.toThrow(
        'User not found',
      );
    });

    it('should return null name when user has no name set', async () => {
      const userWithoutName = { ...mockUser, name: null };
      mockPrismaService.user.findUnique.mockResolvedValue(userWithoutName);

      const result = await service.getProfile(mockUser.id);

      expect(result.name).toBeNull();
    });

    it('should return profile with null organization for SUPER_ADMIN', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockSuperAdmin);

      const result = await service.getProfile(mockSuperAdmin.id);

      expect(result).toEqual({
        id: mockSuperAdmin.id,
        email: mockSuperAdmin.email,
        name: mockSuperAdmin.name,
        role: mockSuperAdmin.role,
        organization: null,
        createdAt: mockSuperAdmin.createdAt,
        updatedAt: mockSuperAdmin.updatedAt,
      });
    });

    it('should exclude sensitive fields (clerkId, organizationId) from response', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getProfile(mockUser.id);

      expect(result).not.toHaveProperty('clerkId');
      expect(result).not.toHaveProperty('organizationId');
    });
  });

  describe('updateProfile', () => {
    it('should update and return profile with organization details', async () => {
      const updatedUser = {
        ...mockUser,
        name: 'Updated Name',
        updatedAt: new Date('2026-01-02'),
      };
      mockPrismaService.user.update.mockResolvedValue(updatedUser);

      const result = await service.updateProfile(mockUser.id, {
        name: 'Updated Name',
      });

      expect(result).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        name: 'Updated Name',
        role: mockUser.role,
        organization: mockOrganization,
        createdAt: mockUser.createdAt,
        updatedAt: new Date('2026-01-02'),
      });
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { name: 'Updated Name' },
        ...userWithOrgInclude,
      });
    });

    it('should update profile with empty data object', async () => {
      mockPrismaService.user.update.mockResolvedValue(mockUser);

      const result = await service.updateProfile(mockUser.id, {});

      expect(result.id).toBe(mockUser.id);
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { name: undefined },
        ...userWithOrgInclude,
      });
    });

    it('should sanitize HTML tags from name', async () => {
      const updatedUser = { ...mockUser, name: 'Clean Name' };
      mockPrismaService.user.update.mockResolvedValue(updatedUser);

      await service.updateProfile(mockUser.id, {
        name: '<script>alert("xss")</script>Clean Name',
      });

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { name: 'alert("xss")Clean Name' },
        ...userWithOrgInclude,
      });
    });

    it('should trim whitespace from sanitized name', async () => {
      const updatedUser = { ...mockUser, name: 'Trimmed Name' };
      mockPrismaService.user.update.mockResolvedValue(updatedUser);

      await service.updateProfile(mockUser.id, { name: '  Trimmed Name  ' });

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { name: 'Trimmed Name' },
        ...userWithOrgInclude,
      });
    });

    it('should throw NotFoundException when updating non-existent user (P2025)', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Record to update not found',
        { code: 'P2025', clientVersion: '5.0.0' },
      );
      mockPrismaService.user.update.mockRejectedValue(prismaError);

      await expect(
        service.updateProfile('nonexistent-id', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should rethrow non-P2025 errors from update', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Some other error',
        { code: 'P2002', clientVersion: '5.0.0' },
      );
      mockPrismaService.user.update.mockRejectedValue(prismaError);

      await expect(
        service.updateProfile('user-id', { name: 'New Name' }),
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    });
  });

  describe('findByOrganization', () => {
    it('should find all active users in an organization', async () => {
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
        where: { organizationId: mockOrganization.id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array when organization has no users', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([]);

      const result = await service.findByOrganization('empty-org-id');

      expect(result).toEqual([]);
      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'empty-org-id', deletedAt: null },
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
        clerkId: 'user_123456',
        email: 'test@example.com',
        role: Role.CLIENT,
        organizationId: 'nonexistent-org-id',
      };

      mockPrismaService.user.create.mockRejectedValue(
        new Error('Foreign key constraint failed on the field: `organizationId`'),
      );

      await expect(service.createFromClerk(createData)).rejects.toThrow();
    });
  });

  describe('syncOrCreateUser', () => {
    const mockInvitation = {
      id: 'inv-uuid-1',
      email: 'new@example.com',
      role: Role.CLIENT,
      organizationId: mockOrganization.id,
      token: 'token-1',
      reissueToken: 'reissue-1',
      reissueCount: 0,
      status: InvitationStatus.PENDING,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      invitedBy: null,
    };

    it('should return existing user when found by clerkId', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.syncOrCreateUser({
        clerkId: 'user_123456',
        email: 'test@example.com',
      });

      expect(result).toEqual(mockUser);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { clerkId: 'user_123456' },
        include: { organization: true },
      });
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should return existing SUPER_ADMIN with null organization', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockSuperAdmin);

      const result = await service.syncOrCreateUser({
        clerkId: 'user_superadmin',
        email: 'admin@codeweaves.com',
      });

      expect(result).toEqual(mockSuperAdmin);
      expect(result.organization).toBeNull();
      expect(result.organizationId).toBeNull();
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException for soft-deleted user', async () => {
      const deletedUser = {
        ...mockUser,
        deletedAt: new Date('2026-02-01'),
      };
      mockPrismaService.user.findUnique.mockResolvedValue(deletedUser);

      await expect(
        service.syncOrCreateUser({
          clerkId: 'user_123456',
          email: 'test@example.com',
        }),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        service.syncOrCreateUser({
          clerkId: 'user_123456',
          email: 'test@example.com',
        }),
      ).rejects.toThrow('Account has been deactivated');

      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should create user from invitation on first login', async () => {
      const createdUser = {
        ...mockUser,
        id: 'new-user-uuid',
        clerkId: 'user_new',
        email: 'new@example.com',
      };

      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.userInvitation.findFirst.mockResolvedValue(mockInvitation);
      mockPrismaService.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            user: { create: jest.fn().mockResolvedValue(createdUser) },
            userInvitation: {
              update: jest.fn().mockResolvedValue({
                ...mockInvitation,
                status: InvitationStatus.ACCEPTED,
              }),
            },
          };
          return fn(tx);
        },
      );

      const result = await service.syncOrCreateUser({
        clerkId: 'user_new',
        email: 'new@example.com',
      });

      expect(result).toEqual(createdUser);
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should normalize email to lowercase for invitation lookup', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.userInvitation.findFirst.mockResolvedValue(null);

      await expect(
        service.syncOrCreateUser({
          clerkId: 'user_mixed',
          email: 'User@Example.COM',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockPrismaService.userInvitation.findFirst).toHaveBeenCalledWith({
        where: {
          email: 'user@example.com',
          status: InvitationStatus.PENDING,
          expiresAt: { gt: expect.any(Date) },
        },
      });
    });

    it('should throw UnauthorizedException when no invitation exists', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.userInvitation.findFirst.mockResolvedValue(null);

      await expect(
        service.syncOrCreateUser({
          clerkId: 'user_unknown',
          email: 'unknown@example.com',
        }),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        service.syncOrCreateUser({
          clerkId: 'user_unknown',
          email: 'unknown@example.com',
        }),
      ).rejects.toThrow('No valid invitation found');
    });

    it('should mark invitation as accepted in the transaction', async () => {
      const createdUser = {
        ...mockUser,
        id: 'new-uuid',
        clerkId: 'user_inv-test',
        email: 'inv@example.com',
      };

      let capturedInvUpdate: unknown;

      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.userInvitation.findFirst.mockResolvedValue({
        ...mockInvitation,
        email: 'inv@example.com',
      });
      mockPrismaService.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            user: { create: jest.fn().mockResolvedValue(createdUser) },
            userInvitation: {
              update: jest.fn().mockImplementation((args) => {
                capturedInvUpdate = args;
                return { ...mockInvitation, status: InvitationStatus.ACCEPTED };
              }),
            },
          };
          return fn(tx);
        },
      );

      await service.syncOrCreateUser({
        clerkId: 'user_inv-test',
        email: 'inv@example.com',
      });

      expect(capturedInvUpdate).toEqual({
        where: { id: mockInvitation.id },
        data: { status: InvitationStatus.ACCEPTED },
      });
    });

    it('should handle race condition with unique constraint error', async () => {
      const existingUser = {
        ...mockUser,
        clerkId: 'user_race',
        email: 'race@example.com',
      };

      mockPrismaService.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingUser);

      mockPrismaService.userInvitation.findFirst.mockResolvedValue({
        ...mockInvitation,
        email: 'race@example.com',
      });

      mockPrismaService.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.0.0',
        }),
      );

      const result = await service.syncOrCreateUser({
        clerkId: 'user_race',
        email: 'race@example.com',
      });

      expect(result).toEqual(existingUser);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledTimes(2);
    });

    it('should rethrow non-P2002 errors from transaction', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.userInvitation.findFirst.mockResolvedValue({
        ...mockInvitation,
        email: 'error@example.com',
      });
      mockPrismaService.$transaction.mockRejectedValue(
        new Error('Database connection lost'),
      );

      await expect(
        service.syncOrCreateUser({
          clerkId: 'user_error',
          email: 'error@example.com',
        }),
      ).rejects.toThrow('Database connection lost');
    });

    it('should assign role from invitation', async () => {
      const adminInvitation = {
        ...mockInvitation,
        email: 'admin@example.com',
        role: Role.ADMIN,
      };
      const adminUser = {
        ...mockUser,
        id: 'admin-uuid',
        clerkId: 'user_admin',
        email: 'admin@example.com',
        role: Role.ADMIN,
      };

      let capturedCreateData: unknown;

      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.userInvitation.findFirst.mockResolvedValue(adminInvitation);
      mockPrismaService.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            user: {
              create: jest.fn().mockImplementation((args) => {
                capturedCreateData = args;
                return adminUser;
              }),
            },
            userInvitation: {
              update: jest.fn().mockResolvedValue({
                ...adminInvitation,
                status: InvitationStatus.ACCEPTED,
              }),
            },
          };
          return fn(tx);
        },
      );

      const result = await service.syncOrCreateUser({
        clerkId: 'user_admin',
        email: 'admin@example.com',
      });

      expect(result.role).toBe(Role.ADMIN);
      expect(
        (capturedCreateData as { data: { role: Role } }).data.role,
      ).toBe(Role.ADMIN);
    });
  });

  describe('findAllForTenant', () => {
    it('should filter by organizationId and exclude soft-deleted for CLIENT user', async () => {
      const users = [mockUser];
      mockPrismaService.user.findMany.mockResolvedValue(users);

      const clientUser = { role: Role.CLIENT, organizationId: mockOrganization.id };
      const result = await service.findAllForTenant(clientUser);

      expect(result).toEqual(users);
      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith({
        where: { organizationId: mockOrganization.id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return all non-deleted users for SUPER_ADMIN (no org filter)', async () => {
      const allUsers = [mockUser, mockSuperAdmin];
      mockPrismaService.user.findMany.mockResolvedValue(allUsers);

      const superAdmin = { role: Role.SUPER_ADMIN, organizationId: null };
      const result = await service.findAllForTenant(superAdmin);

      expect(result).toEqual(allUsers);
      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return all non-deleted users for ADMIN (no org filter)', async () => {
      const allUsers = [mockUser];
      mockPrismaService.user.findMany.mockResolvedValue(allUsers);

      const admin = { role: Role.ADMIN, organizationId: 'org-uuid' };
      const result = await service.findAllForTenant(admin);

      expect(result).toEqual(allUsers);
      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should throw ForbiddenException for CLIENT without organizationId', async () => {
      const clientUser = { role: Role.CLIENT, organizationId: null };

      await expect(service.findAllForTenant(clientUser)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
