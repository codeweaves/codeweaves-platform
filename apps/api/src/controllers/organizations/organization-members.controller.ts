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
import { OrganizationMembersService } from '../../services/organization-members.service';
import { TenantGuard } from '../../guards/tenant.guard';
import { CurrentUser, CurrentUserData } from '../../decorators/current-user.decorator';
import { RequirePermission } from '../../decorators/require-permission.decorator';
import { Resource, Action } from '../../common/rbac/rbac.types';

@ApiTags('Organization Members')
@ApiBearerAuth()
@Controller('organizations/:orgId/members')
@UseGuards(TenantGuard)
export class OrganizationMembersController {
  constructor(
    private readonly membersService: OrganizationMembersService,
  ) {}

  @Get()
  @RequirePermission(Resource.Member, Action.Read)
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
      accessScope: user.accessScope,
      organizationId: user.organizationId,
    });
  }

  @Patch(':userId')
  @RequirePermission(Resource.Member, Action.Manage)
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
  @RequirePermission(Resource.Member, Action.Manage)
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
