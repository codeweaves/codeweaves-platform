import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { InvitationsService } from '../../services/invitations.service';
import {
  CreateInvitationDto,
  ReissueInvitationDto,
} from '../../models/invitation.dto';
import {
  CurrentUser,
  CurrentUserData,
} from '../../decorators/current-user.decorator';
import { Roles } from '../../decorators/roles.decorator';
import { RolesGuard } from '../../guards/roles.guard';
import { Public } from '../../decorators/public.decorator';

@ApiTags('Invitations')
@ApiBearerAuth()
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Create a new invitation' })
  @ApiResponse({ status: 201, description: 'Invitation created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - SUPER_ADMIN or ADMIN only' })
  async create(
    @Body() dto: CreateInvitationDto,
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
  async validate(@Param('token') token: string) {
    return this.invitationsService.validate(token);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'List all invitations' })
  @ApiResponse({ status: 200, description: 'List of invitations' })
  @ApiResponse({ status: 403, description: 'Forbidden - SUPER_ADMIN or ADMIN only' })
  async findAll() {
    return this.invitationsService.findAll();
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Get invitation by ID' })
  @ApiParam({ name: 'id', description: 'Invitation UUID' })
  @ApiResponse({ status: 200, description: 'Invitation details' })
  @ApiResponse({ status: 404, description: 'Invitation not found' })
  async findById(@Param('id') id: string) {
    return this.invitationsService.findById(id);
  }

  @Post(':id/resend')
  @Roles(Role.SUPER_ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Resend an invitation' })
  @ApiParam({ name: 'id', description: 'Invitation UUID' })
  @ApiResponse({ status: 200, description: 'Invitation resent' })
  @ApiResponse({ status: 404, description: 'Invitation not found' })
  async resend(@Param('id') id: string) {
    return this.invitationsService.resend(id);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  @UseGuards(RolesGuard)
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
  async reissue(@Body() dto: ReissueInvitationDto) {
    return this.invitationsService.reissue(dto.reissueToken);
  }
}
