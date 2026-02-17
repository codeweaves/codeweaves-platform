import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { OrganizationsService } from '../../../src/services/organizations.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { OrganizationLoggerService } from '../../../src/common/logger/organization.logger';
import { Prisma } from '@prisma/client';
import * as slugUtils from '../../../src/utils/slug';

describe('OrganizationsService', () => {
  let service: OrganizationsService;

  const mockPrismaService = {
    organization: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockOrganization = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Acme Corp',
    slug: 'acme-corp',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const mockOrgWithCounts = {
    ...mockOrganization,
    _count: { users: 5 },
  };

  const p2002Error = new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    { code: 'P2002', clientVersion: '5.0.0' },
  );

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: OrganizationLoggerService,
          useValue: {
            logOrganizationCreated: jest.fn(),
            logOrganizationCreationFailed: jest.fn(),
            logOrganizationCreationException: jest.fn(),
            logOrganizationUpdated: jest.fn(),
            logOrganizationUpdateException: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<OrganizationsService>(OrganizationsService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create an organization with auto-generated slug', async () => {
      mockPrismaService.organization.findUnique.mockResolvedValue(null);
      mockPrismaService.organization.create.mockResolvedValue(mockOrganization);

      const result = await service.create({ name: 'Acme Corp' });

      expect(result).toEqual(mockOrganization);
      expect(mockPrismaService.organization.create).toHaveBeenCalledWith({
        data: {
          name: 'Acme Corp',
          slug: 'acme-corp',
        },
      });
    });

    it('should create an organization with a provided slug', async () => {
      mockPrismaService.organization.findUnique.mockResolvedValue(null);
      mockPrismaService.organization.create.mockResolvedValue({
        ...mockOrganization,
        slug: 'custom-slug',
      });

      const result = await service.create({
        name: 'Acme Corp',
        slug: 'custom-slug',
      });

      expect(result.slug).toBe('custom-slug');
      expect(mockPrismaService.organization.create).toHaveBeenCalledWith({
        data: {
          name: 'Acme Corp',
          slug: 'custom-slug',
        },
      });
    });

    it('should handle slug collision by generating unique slug', async () => {
      const existingOrg = { ...mockOrganization };
      mockPrismaService.organization.findUnique.mockResolvedValue(existingOrg);

      const uniqueSlug = 'acme-corp-a1b2c3';
      jest.spyOn(slugUtils, 'generateUniqueSlug').mockReturnValue(uniqueSlug);

      mockPrismaService.organization.create.mockResolvedValue({
        ...mockOrganization,
        slug: uniqueSlug,
      });

      const result = await service.create({ name: 'Acme Corp' });

      expect(result.slug).toBe(uniqueSlug);
      expect(slugUtils.generateUniqueSlug).toHaveBeenCalledWith('acme-corp');
      expect(mockPrismaService.organization.create).toHaveBeenCalledWith({
        data: {
          name: 'Acme Corp',
          slug: uniqueSlug,
        },
      });
    });

    it('should retry with new slug on P2002 race condition', async () => {
      mockPrismaService.organization.findUnique.mockResolvedValue(null);

      const retrySlug = 'acme-corp-retry1';
      jest.spyOn(slugUtils, 'generateUniqueSlug').mockReturnValue(retrySlug);

      mockPrismaService.organization.create
        .mockRejectedValueOnce(p2002Error)
        .mockResolvedValueOnce({ ...mockOrganization, slug: retrySlug });

      const result = await service.create({ name: 'Acme Corp' });

      expect(result.slug).toBe(retrySlug);
      expect(mockPrismaService.organization.create).toHaveBeenCalledTimes(2);
    });

    it('should throw ConflictException after exhausting all retries', async () => {
      mockPrismaService.organization.findUnique.mockResolvedValue(null);
      jest.spyOn(slugUtils, 'generateUniqueSlug').mockReturnValue('slug-retry');

      mockPrismaService.organization.create.mockRejectedValue(p2002Error);

      await expect(
        service.create({ name: 'Acme Corp' }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrismaService.organization.create).toHaveBeenCalledTimes(3);
    });

    it('should throw BadRequestException when name has no alphanumeric characters', async () => {
      await expect(
        service.create({ name: '!@#$%' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should rethrow non-P2002 errors from create without retry', async () => {
      mockPrismaService.organization.findUnique.mockResolvedValue(null);
      mockPrismaService.organization.create.mockRejectedValue(
        new Error('Database connection lost'),
      );

      await expect(
        service.create({ name: 'Acme Corp' }),
      ).rejects.toThrow('Database connection lost');
      expect(mockPrismaService.organization.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('findAll', () => {
    const defaultQuery = { page: 1, limit: 20, sortBy: 'createdAt' as const, sortOrder: 'desc' as const };

    it('should return paginated organizations with user counts', async () => {
      const orgs = [
        mockOrgWithCounts,
        {
          ...mockOrgWithCounts,
          id: '223e4567-e89b-12d3-a456-426614174000',
          name: 'Beta Inc',
          slug: 'beta-inc',
          _count: { users: 3 },
        },
      ];

      mockPrismaService.organization.findMany.mockResolvedValue(orgs);
      mockPrismaService.organization.count.mockResolvedValue(2);

      const result = await service.findAll(defaultQuery);

      expect(result.data).toEqual(orgs);
      expect(result.data).toHaveLength(2);
      expect(result.data[0]!._count.users).toBe(5);
      expect(result.meta).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
      expect(mockPrismaService.organization.findMany).toHaveBeenCalledWith({
        where: {},
        include: {
          _count: {
            select: {
              users: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
    });

    it('should return empty data when no organizations exist', async () => {
      mockPrismaService.organization.findMany.mockResolvedValue([]);
      mockPrismaService.organization.count.mockResolvedValue(0);

      const result = await service.findAll(defaultQuery);

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
    });

    it('should apply search filter on name and slug', async () => {
      mockPrismaService.organization.findMany.mockResolvedValue([mockOrgWithCounts]);
      mockPrismaService.organization.count.mockResolvedValue(1);

      await service.findAll({ ...defaultQuery, search: 'acme' });

      expect(mockPrismaService.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { name: { contains: 'acme', mode: 'insensitive' } },
              { slug: { contains: 'acme', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('should apply pagination correctly', async () => {
      mockPrismaService.organization.findMany.mockResolvedValue([]);
      mockPrismaService.organization.count.mockResolvedValue(25);

      const result = await service.findAll({ ...defaultQuery, page: 2, limit: 10 });

      expect(mockPrismaService.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
      expect(result.meta.totalPages).toBe(3);
    });

    it('should sort by name', async () => {
      mockPrismaService.organization.findMany.mockResolvedValue([]);
      mockPrismaService.organization.count.mockResolvedValue(0);

      await service.findAll({ ...defaultQuery, sortBy: 'name', sortOrder: 'asc' });

      expect(mockPrismaService.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { name: 'asc' },
        }),
      );
    });

    it('should sort by users count', async () => {
      mockPrismaService.organization.findMany.mockResolvedValue([]);
      mockPrismaService.organization.count.mockResolvedValue(0);

      await service.findAll({ ...defaultQuery, sortBy: 'usersCount', sortOrder: 'desc' });

      expect(mockPrismaService.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { users: { _count: 'desc' } },
        }),
      );
    });

    it('should use defaults when called without params', async () => {
      mockPrismaService.organization.findMany.mockResolvedValue([]);
      mockPrismaService.organization.count.mockResolvedValue(0);

      await service.findAll();

      expect(mockPrismaService.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          orderBy: { createdAt: 'desc' },
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return organization with user counts', async () => {
      mockPrismaService.organization.findUnique.mockResolvedValue(
        mockOrgWithCounts,
      );

      const result = await service.findById(mockOrganization.id);

      expect(result).toEqual(mockOrgWithCounts);
      expect(mockPrismaService.organization.findUnique).toHaveBeenCalledWith({
        where: { id: mockOrganization.id },
        include: {
          _count: {
            select: {
              users: true,
            },
          },
        },
      });
    });

    it('should throw NotFoundException when organization does not exist', async () => {
      mockPrismaService.organization.findUnique.mockResolvedValue(null);

      await expect(service.findById('nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findById('nonexistent-id')).rejects.toThrow(
        'Organization not found',
      );
    });
  });

  describe('update', () => {
    it('should update organization name', async () => {
      const updated = { ...mockOrganization, name: 'New Name' };
      mockPrismaService.organization.update.mockResolvedValue(updated);

      const result = await service.update(mockOrganization.id, {
        name: 'New Name',
      });

      expect(result.name).toBe('New Name');
      expect(mockPrismaService.organization.update).toHaveBeenCalledWith({
        where: { id: mockOrganization.id },
        data: { name: 'New Name' },
      });
    });

    it('should update organization slug', async () => {
      mockPrismaService.organization.findFirst.mockResolvedValue(null);

      const updated = { ...mockOrganization, slug: 'new-slug' };
      mockPrismaService.organization.update.mockResolvedValue(updated);

      const result = await service.update(mockOrganization.id, {
        slug: 'new-slug',
      });

      expect(result.slug).toBe('new-slug');
      expect(mockPrismaService.organization.findFirst).toHaveBeenCalledWith({
        where: { slug: 'new-slug', NOT: { id: mockOrganization.id } },
      });
    });

    it('should update both name and slug', async () => {
      mockPrismaService.organization.findFirst.mockResolvedValue(null);

      const updated = {
        ...mockOrganization,
        name: 'New Name',
        slug: 'new-slug',
      };
      mockPrismaService.organization.update.mockResolvedValue(updated);

      const result = await service.update(mockOrganization.id, {
        name: 'New Name',
        slug: 'new-slug',
      });

      expect(result.name).toBe('New Name');
      expect(result.slug).toBe('new-slug');
    });

    it('should throw ConflictException when slug is already in use', async () => {
      const existingOrg = {
        ...mockOrganization,
        id: 'other-org-id',
        slug: 'taken-slug',
      };
      mockPrismaService.organization.findFirst.mockResolvedValue(existingOrg);

      await expect(
        service.update(mockOrganization.id, { slug: 'taken-slug' }),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.update(mockOrganization.id, { slug: 'taken-slug' }),
      ).rejects.toThrow('Slug is already in use');
    });

    it('should throw NotFoundException when organization does not exist (P2025)', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Record to update not found',
        { code: 'P2025', clientVersion: '5.0.0' },
      );
      mockPrismaService.organization.update.mockRejectedValue(prismaError);

      await expect(
        service.update('nonexistent-id', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException on unique constraint violation (P2002)', async () => {
      mockPrismaService.organization.findFirst.mockResolvedValue(null);
      mockPrismaService.organization.update.mockRejectedValue(p2002Error);

      await expect(
        service.update(mockOrganization.id, { slug: 'race-condition-slug' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should rethrow non-Prisma errors', async () => {
      mockPrismaService.organization.update.mockRejectedValue(
        new Error('Database connection lost'),
      );

      await expect(
        service.update(mockOrganization.id, { name: 'New Name' }),
      ).rejects.toThrow('Database connection lost');
    });
  });
});
