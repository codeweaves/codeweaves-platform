import { Controller, Get, Put, Patch, Param, Body, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { UserRolesService } from '../../services/user-roles.service';
import { RequirePermission } from '../../decorators/require-permission.decorator';
import { Resource, Action } from '../../common/rbac/rbac.types';
import { CurrentUser, CurrentUserData } from '../../decorators/current-user.decorator';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import {
  setUserRolesSchema,
  setAccessScopeSchema,
  userListQuerySchema,
  userIdParamsSchema,
} from '../../models/rbac.dto';
import type {
  SetUserRolesDto,
  SetAccessScopeDto,
  UserListQuery,
  UserIdParams,
} from '../../models/rbac.dto';

/**
 * Role administration.
 *
 * The read endpoints are scope-filtered rather than permission-filtered: an
 * ORG-scope caller sees only their own organization's users no matter what they
 * pass, which is enforced in the service, not here.
 */
@ApiTags('RBAC')
@ApiBearerAuth()
@Controller()
export class RbacController {
  constructor(private readonly userRoles: UserRolesService) {}

  @Get('rbac/roles')
  @RequirePermission(Resource.Role, Action.Read)
  @ApiOperation({
    summary: 'Roles this caller may assign (filtered — platform roles are omitted for org callers)',
  })
  @ApiResponse({ status: 200, description: 'Assignable role catalog' })
  async listRoles(@CurrentUser() user: CurrentUserData) {
    return this.userRoles.listAssignableRoles(user);
  }

  @Get('users')
  @RequirePermission(Resource.User, Action.ReadAll)
  @ApiOperation({ summary: 'List users' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Name or email' })
  @ApiQuery({ name: 'organizationId', required: false, type: String })
  @ApiQuery({ name: 'accessScope', required: false, enum: ['PLATFORM', 'ORG'] })
  @ApiResponse({ status: 200, description: 'Paginated users with their role keys' })
  async listUsers(
    @Query(new ZodValidationPipe(userListQuerySchema)) query: UserListQuery,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.userRoles.listUsers(user, query);
  }

  @Get('users/:id')
  @RequirePermission(Resource.User, Action.Read)
  @ApiOperation({ summary: 'One user with roles and derived permissions' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User detail' })
  @ApiResponse({ status: 404, description: 'Not found, or outside your organization' })
  async getUser(
    @Param(new ZodValidationPipe(userIdParamsSchema)) params: UserIdParams,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.userRoles.getUser(user, params.id);
  }

  /**
   * PUT, not PATCH: the dialog submits the complete checked set, so replace
   * semantics avoid a lost update when two managers edit the same person. The
   * service diffs against current state for the audit entry.
   */
  @Put('users/:id/roles')
  @RequirePermission(Resource.Member, Action.Manage)
  @ApiOperation({ summary: 'Replace a user role set' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'Updated user detail' })
  @ApiResponse({ status: 400, description: 'Unknown role, or a role unavailable to this user' })
  @ApiResponse({ status: 403, description: 'Role not assignable by you, or self-modification' })
  @ApiResponse({ status: 404, description: 'Not found, or outside your organization' })
  async setRoles(
    @Param(new ZodValidationPipe(userIdParamsSchema)) params: UserIdParams,
    @Body(new ZodValidationPipe(setUserRolesSchema)) body: SetUserRolesDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.userRoles.setRoles(user, params.id, body.roleKeys);
  }

  @Patch('users/:id/scope')
  @RequirePermission(Resource.User, Action.ManageScope)
  @ApiOperation({ summary: 'Change a user access scope (super admin only)' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'Updated user detail' })
  @ApiResponse({ status: 403, description: 'Super admin only, or self-modification' })
  async setAccessScope(
    @Param(new ZodValidationPipe(userIdParamsSchema)) params: UserIdParams,
    @Body(new ZodValidationPipe(setAccessScopeSchema)) body: SetAccessScopeDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.userRoles.setAccessScope(user, params.id, body.accessScope);
  }
}
