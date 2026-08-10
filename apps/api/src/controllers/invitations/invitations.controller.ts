import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { InvitationsService } from '../../services/invitations.service';
import {
  CreateInvitationDto,
  ReissueInvitationDto,
  createInvitationSchema,
  reissueInvitationSchema,
  invitationListQuerySchema,
  type InvitationListQuery,
} from '../../models/invitation.dto';
import {
  CurrentUser,
  CurrentUserData,
} from '../../decorators/current-user.decorator';
import { Public } from '../../decorators/public.decorator';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { RequirePermission } from '../../decorators/require-permission.decorator';
import { Resource, Action } from '../../common/rbac/rbac.types';

@ApiTags('Invitations')
@ApiBearerAuth()
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @RequirePermission(Resource.Invitation, Action.Create)
  @ApiOperation({ summary: 'Create a new invitation' })
  @ApiResponse({ status: 201, description: 'Invitation created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - SUPER_ADMIN only' })
  async create(
    @Body(new ZodValidationPipe(createInvitationSchema)) dto: CreateInvitationDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.invitationsService.create(dto, user.id);
  }

  @Get('validate/:token')
  @Public()
  @ApiOperation({ summary: 'Validate an invitation token' })
  @ApiParam({ name: 'token', description: 'Invitation token' })
  @ApiResponse({ status: 200, description: 'Invitation details' })
  @ApiResponse({ status: 404, description: 'Invalid or expired token' })
  @RequirePermission(Resource.Invitation, Action.Read)
  async validate(@Param('token') token: string) {
    return this.invitationsService.validate(token);
  }

  @Get()
  @RequirePermission(Resource.Invitation, Action.Read)
  @ApiOperation({ summary: 'List all invitations' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by email' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'ACCEPTED', 'EXPIRED'], description: 'Filter by status' })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['email', 'status', 'createdAt', 'expiresAt'], description: 'Sort field (default: createdAt)' })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'], description: 'Sort order (default: desc)' })
  @ApiResponse({ status: 200, description: 'Paginated list of invitations' })
  @ApiResponse({ status: 403, description: 'Forbidden - SUPER_ADMIN or ADMIN only' })
  async findAll(
    @Query(new ZodValidationPipe(invitationListQuerySchema))
    query: InvitationListQuery,
  ) {
    return this.invitationsService.findAll(query);
  }

  @Get(':id')
  @RequirePermission(Resource.Invitation, Action.Read)
  @ApiOperation({ summary: 'Get invitation by ID' })
  @ApiParam({ name: 'id', description: 'Invitation UUID' })
  @ApiResponse({ status: 200, description: 'Invitation details' })
  @ApiResponse({ status: 404, description: 'Invitation not found' })
  async findById(@Param('id') id: string) {
    return this.invitationsService.findById(id);
  }

  @Post(':id/resend')
  @RequirePermission(Resource.Invitation, Action.Update)
  @ApiOperation({ summary: 'Resend an invitation' })
  @ApiParam({ name: 'id', description: 'Invitation UUID' })
  @ApiResponse({ status: 200, description: 'Invitation resent' })
  @ApiResponse({ status: 404, description: 'Invitation not found' })
  async resend(@Param('id') id: string) {
    return this.invitationsService.resend(id);
  }

  @Delete(':id')
  @RequirePermission(Resource.Invitation, Action.Delete)
  @ApiOperation({ summary: 'Cancel an invitation' })
  @ApiParam({ name: 'id', description: 'Invitation UUID' })
  @ApiResponse({ status: 200, description: 'Invitation cancelled' })
  @ApiResponse({ status: 404, description: 'Invitation not found' })
  async cancel(@Param('id') id: string) {
    return this.invitationsService.cancel(id);
  }

  @Post('reissue')
  @Public()
  @ApiOperation({ summary: 'Reissue an expired invitation' })
  @ApiResponse({ status: 201, description: 'New invitation issued' })
  @ApiResponse({ status: 404, description: 'Reissue token not found' })
  @RequirePermission(Resource.Invitation, Action.Create)
  async reissue(
    @Body(new ZodValidationPipe(reissueInvitationSchema)) dto: ReissueInvitationDto,
  ) {
    return this.invitationsService.reissue(dto.reissueToken);
  }
}
