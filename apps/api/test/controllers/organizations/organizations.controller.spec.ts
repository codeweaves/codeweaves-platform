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
} from '../../../src/models/organization.dto';

describe('OrganizationsController', () => {
  let controller: OrganizationsController;

  const mockOrganizationsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
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
    it('should return all organizations', async () => {
      const orgs = [mockOrgWithCounts];
      mockOrganizationsService.findAll.mockResolvedValue(orgs);

      const result = await controller.findAll();

      expect(result).toEqual(orgs);
      expect(mockOrganizationsService.findAll).toHaveBeenCalled();
    });

    it('should return empty array when no organizations exist', async () => {
      mockOrganizationsService.findAll.mockResolvedValue([]);

      const result = await controller.findAll();

      expect(result).toEqual([]);
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
    it('should have SUPER_ADMIN role metadata on controller', () => {
      const roles = Reflect.getMetadata(
        'roles',
        OrganizationsController,
      );
      expect(roles).toEqual(['SUPER_ADMIN']);
    });
  });

  describe('validation', () => {
    const createPipe = new ZodValidationPipe(createOrganizationSchema);
    const updatePipe = new ZodValidationPipe(updateOrganizationSchema);

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

    it('should accept update with empty body', () => {
      const result = updatePipe.transform({});
      expect(result).toEqual({});
    });

    it('should reject update with name too short', () => {
      expect(() => updatePipe.transform({ name: 'AB' })).toThrow(BadRequestException);
    });
  });
});
