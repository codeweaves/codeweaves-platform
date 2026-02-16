import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { OrganizationsService } from '../../services/organizations.service';
import { Roles } from '../../decorators/roles.decorator';
import { RolesGuard } from '../../guards/roles.guard';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  organizationListQuerySchema,
} from '../../models/organization.dto';
import type {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  OrganizationListQuery,
} from '../../models/organization.dto';

@ApiTags('Organizations')
@ApiBearerAuth()
@Controller('organizations')
@UseGuards(RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new organization' })
  @ApiResponse({ status: 201, description: 'Organization created' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - SUPER_ADMIN only' })
  async create(
    @Body(new ZodValidationPipe(createOrganizationSchema))
    dto: CreateOrganizationDto,
  ) {
    return this.organizationsService.create(dto);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'List all organizations' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by name or slug' })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['name', 'slug', 'createdAt', 'usersCount'], description: 'Sort field (default: createdAt)' })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'], description: 'Sort order (default: desc)' })
  @ApiResponse({ status: 200, description: 'Paginated list of organizations' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - SUPER_ADMIN or ADMIN only' })
  async findAll(
    @Query(new ZodValidationPipe(organizationListQuerySchema))
    query: OrganizationListQuery,
  ) {
    return this.organizationsService.findAll(query);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Get organization by ID' })
  @ApiParam({ name: 'id', description: 'Organization UUID' })
  @ApiResponse({ status: 200, description: 'Organization details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - SUPER_ADMIN or ADMIN only' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.organizationsService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an organization' })
  @ApiParam({ name: 'id', description: 'Organization UUID' })
  @ApiResponse({ status: 200, description: 'Organization updated' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - SUPER_ADMIN only' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  @ApiResponse({ status: 409, description: 'Slug already in use' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateOrganizationSchema))
    dto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.update(id, dto);
  }
}
