import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrganizationsController } from '../../../src/controllers/organizations/organizations.controller';
import { OrganizationsService } from '../../../src/services/organizations.service';
import { RolesGuard } from '../../../src/guards/roles.guard';
import { ZodValidationPipe } from '../../../src/pipes/zod-validation.pipe';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  organizationListQuerySchema,
} from '../../../src/models/organization.dto';

describe('OrganizationsController', () => {
  let controller: OrganizationsController;

  const mockOrganizationsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    getDeletePreview: jest.fn(),
    delete: jest.fn(),
  };

  const superAdminUser = {
    clerkId: 'user_sa',
    id: 'sa-id',
    role: 'SUPER_ADMIN' as const,
    organizationId: null,
    organization: null,
    email: 'sa@example.com',
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

  const mockPaginatedResponse = {
    data: [mockOrgWithCounts],
    meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrganizationsController],
      providers: [
        { provide: OrganizationsService, useValue: mockOrganizationsService },
        Reflector,
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<OrganizationsController>(OrganizationsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create an organization', async () => {
      const dto = { name: 'Acme Corp' };
      mockOrganizationsService.create.mockResolvedValue(mockOrganization);

      const result = await controller.create(dto);

      expect(result).toEqual(mockOrganization);
      expect(mockOrganizationsService.create).toHaveBeenCalledWith(dto);
    });

    it('should create an organization with custom slug', async () => {
      const dto = { name: 'Acme Corp', slug: 'custom-slug' };
      const orgWithCustomSlug = { ...mockOrganization, slug: 'custom-slug' };
      mockOrganizationsService.create.mockResolvedValue(orgWithCustomSlug);

      const result = await controller.create(dto);

      expect(result.slug).toBe('custom-slug');
      expect(mockOrganizationsService.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('findAll', () => {
    const defaultQuery = { page: 1, limit: 20, sortBy: 'createdAt' as const, sortOrder: 'desc' as const };

    it('should return paginated organizations', async () => {
      mockOrganizationsService.findAll.mockResolvedValue(mockPaginatedResponse);

      const result = await controller.findAll(defaultQuery);

      expect(result).toEqual(mockPaginatedResponse);
      expect(mockOrganizationsService.findAll).toHaveBeenCalledWith(defaultQuery);
    });

    it('should pass search query to service', async () => {
      const query = { ...defaultQuery, search: 'acme' };
      mockOrganizationsService.findAll.mockResolvedValue(mockPaginatedResponse);

      await controller.findAll(query);

      expect(mockOrganizationsService.findAll).toHaveBeenCalledWith(query);
    });

    it('should pass pagination params to service', async () => {
      const query = { page: 2, limit: 10, sortBy: 'name' as const, sortOrder: 'asc' as const };
      mockOrganizationsService.findAll.mockResolvedValue({
        data: [],
        meta: { page: 2, limit: 10, total: 1, totalPages: 1 },
      });

      await controller.findAll(query);

      expect(mockOrganizationsService.findAll).toHaveBeenCalledWith(query);
    });

    it('should return empty data when no organizations exist', async () => {
      const emptyResponse = {
        data: [],
        meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
      };
      mockOrganizationsService.findAll.mockResolvedValue(emptyResponse);

      const result = await controller.findAll(defaultQuery);

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });
  });

  describe('findById', () => {
    it('should return an organization by id', async () => {
      mockOrganizationsService.findById.mockResolvedValue(mockOrgWithCounts);

      const result = await controller.findById(mockOrganization.id);

      expect(result).toEqual(mockOrgWithCounts);
      expect(mockOrganizationsService.findById).toHaveBeenCalledWith(
        mockOrganization.id,
      );
    });

    it('should propagate NotFoundException from service', async () => {
      mockOrganizationsService.findById.mockRejectedValue(
        new NotFoundException('Organization not found'),
      );

      await expect(
        controller.findById('nonexistent-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update an organization', async () => {
      const dto = { name: 'Updated Corp' };
      const updated = { ...mockOrganization, name: 'Updated Corp' };
      mockOrganizationsService.update.mockResolvedValue(updated);

      const result = await controller.update(mockOrganization.id, dto);

      expect(result.name).toBe('Updated Corp');
      expect(mockOrganizationsService.update).toHaveBeenCalledWith(
        mockOrganization.id,
        dto,
      );
    });

    it('should propagate NotFoundException from service', async () => {
      mockOrganizationsService.update.mockRejectedValue(
        new NotFoundException('Organization not found'),
      );

      await expect(
        controller.update('nonexistent-id', { name: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate ConflictException from service', async () => {
      mockOrganizationsService.update.mockRejectedValue(
        new ConflictException('Slug is already in use'),
      );

      await expect(
        controller.update(mockOrganization.id, { slug: 'taken-slug' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('role authorization', () => {
    it('should have SUPER_ADMIN role metadata on controller class', () => {
      const roles = Reflect.getMetadata(
        'roles',
        OrganizationsController,
      );
      expect(roles).toEqual(['SUPER_ADMIN']);
    });

    it('should have @RequirePermission(Organization, ReadAll) on findAll', () => {
      const permission = Reflect.getMetadata(
        'permission',
        OrganizationsController.prototype.findAll,
      );
      expect(permission).toEqual({ resource: 'Organization', action: 'ReadAll' });
    });

    it('should allow SUPER_ADMIN and ADMIN for findById', () => {
      const roles = Reflect.getMetadata(
        'roles',
        OrganizationsController.prototype.findById,
      );
      expect(roles).toEqual(['SUPER_ADMIN', 'ADMIN']);
    });

    it('should not override class-level SUPER_ADMIN for create', () => {
      const roles = Reflect.getMetadata(
        'roles',
        OrganizationsController.prototype.create,
      );
      expect(roles).toBeUndefined();
    });

    it('should not override class-level SUPER_ADMIN for update', () => {
      const roles = Reflect.getMetadata(
        'roles',
        OrganizationsController.prototype.update,
      );
      expect(roles).toBeUndefined();
    });
  });

  describe('validation', () => {
    const createPipe = new ZodValidationPipe(createOrganizationSchema);
    const updatePipe = new ZodValidationPipe(updateOrganizationSchema);
    const listQueryPipe = new ZodValidationPipe(organizationListQuerySchema);

    it('should reject create with missing name', () => {
      expect(() => createPipe.transform({} as unknown)).toThrow(BadRequestException);
    });

    it('should reject create with name too short (less than 3 chars)', () => {
      expect(() => createPipe.transform({ name: 'AB' })).toThrow(BadRequestException);
    });

    it('should reject create with name too long (over 100 chars)', () => {
      expect(() => createPipe.transform({ name: 'A'.repeat(101) })).toThrow(
        BadRequestException,
      );
    });

    it('should accept create with valid name', () => {
      const result = createPipe.transform({ name: 'Valid Org' });
      expect(result.name).toBe('Valid Org');
    });

    it('should reject create with invalid slug format', () => {
      expect(() =>
        createPipe.transform({ name: 'Test', slug: 'INVALID SLUG!' }),
      ).toThrow(BadRequestException);
    });

    it('should accept update with only name', () => {
      const result = updatePipe.transform({ name: 'New Name' });
      expect(result.name).toBe('New Name');
    });

    it('should accept update with only slug', () => {
      const result = updatePipe.transform({ slug: 'new-slug' });
      expect(result.slug).toBe('new-slug');
    });

    it('should reject update with empty body', () => {
      expect(() => updatePipe.transform({})).toThrow(BadRequestException);
    });

    it('should reject update with name too short', () => {
      expect(() => updatePipe.transform({ name: 'AB' })).toThrow(BadRequestException);
    });

    it('should apply defaults for list query with empty params', () => {
      const result = listQueryPipe.transform({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.sortBy).toBe('createdAt');
      expect(result.sortOrder).toBe('desc');
    });

    it('should accept list query with search param', () => {
      const result = listQueryPipe.transform({ search: 'acme' });
      expect(result.search).toBe('acme');
    });

    it('should accept list query with sorting params', () => {
      const result = listQueryPipe.transform({ sortBy: 'name', sortOrder: 'asc' });
      expect(result.sortBy).toBe('name');
      expect(result.sortOrder).toBe('asc');
    });

    it('should coerce page and limit to numbers', () => {
      const result = listQueryPipe.transform({ page: '2', limit: '10' });
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
    });

    it('should reject invalid sortBy value', () => {
      expect(() => listQueryPipe.transform({ sortBy: 'invalid' })).toThrow(BadRequestException);
    });
  });

  describe('getDeletePreview', () => {
    it('should forward the id and current user to the service', async () => {
      const preview = {
        id: mockOrganization.id,
        name: mockOrganization.name,
        slug: mockOrganization.slug,
        activeAgentsCount: 2,
        membersCount: 3,
      };
      mockOrganizationsService.getDeletePreview.mockResolvedValue(preview);

      const result = await controller.getDeletePreview(mockOrganization.id, superAdminUser);

      expect(result).toEqual(preview);
      expect(mockOrganizationsService.getDeletePreview).toHaveBeenCalledWith(
        mockOrganization.id,
        superAdminUser,
      );
    });
  });

  describe('delete', () => {
    it('should forward the id and current user to the service', async () => {
      const deleteResult = {
        id: mockOrganization.id,
        name: mockOrganization.name,
        cascadedAgents: 2,
        cascadedUsers: 3,
      };
      mockOrganizationsService.delete.mockResolvedValue(deleteResult);

      const result = await controller.delete(mockOrganization.id, superAdminUser);

      expect(result).toEqual(deleteResult);
      expect(mockOrganizationsService.delete).toHaveBeenCalledWith(
        mockOrganization.id,
        superAdminUser,
      );
    });
  });
});
