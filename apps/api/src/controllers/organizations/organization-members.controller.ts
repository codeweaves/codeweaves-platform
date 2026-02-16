import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { OrganizationMembersService } from '../../services/organization-members.service';
import { Roles } from '../../decorators/roles.decorator';
import { RolesGuard } from '../../guards/roles.guard';
import { TenantGuard } from '../../guards/tenant.guard';
import { CurrentUser, CurrentUserData } from '../../decorators/current-user.decorator';

@ApiTags('Organization Members')
@ApiBearerAuth()
@Controller('organizations/:orgId/members')
@UseGuards(RolesGuard, TenantGuard)
export class OrganizationMembersController {
  constructor(
    private readonly membersService: OrganizationMembersService,
  ) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.CLIENT)
  @ApiOperation({ summary: 'List organization members' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({ status: 200, description: 'List of organization members' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - no organization assigned' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async listMembers(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.membersService.listMembers(orgId, {
      role: user.role,
      organizationId: user.organizationId,
    });
  }

  @Patch(':userId')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Assign user to organization' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User assigned to organization' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - SUPER_ADMIN only' })
  @ApiResponse({ status: 404, description: 'Organization or user not found' })
  @ApiResponse({ status: 409, description: 'User already assigned to another organization' })
  async assignMember(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.membersService.assignMember(orgId, userId);
  }

  @Delete(':userId')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove user from organization' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiResponse({ status: 204, description: 'User removed from organization' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - SUPER_ADMIN only' })
  @ApiResponse({ status: 404, description: 'Organization or user not found' })
  async removeMember(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.membersService.removeMember(orgId, userId);
  }
}
