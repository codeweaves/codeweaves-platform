import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
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

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN)
  @UseGuards(RolesGuard)
  async create(
    @Body() dto: CreateInvitationDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.invitationsService.create(dto, user.id);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN)
  @UseGuards(RolesGuard)
  async findAll() {
    return this.invitationsService.findAll();
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN)
  @UseGuards(RolesGuard)
  async findById(@Param('id') id: string) {
    return this.invitationsService.findById(id);
  }

  @Post(':id/resend')
  @Roles(Role.SUPER_ADMIN)
  @UseGuards(RolesGuard)
  async resend(@Param('id') id: string) {
    return this.invitationsService.resend(id);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  @UseGuards(RolesGuard)
  async cancel(@Param('id') id: string) {
    return this.invitationsService.cancel(id);
  }

  @Post('reissue')
  @Public()
  async reissue(@Body() dto: ReissueInvitationDto) {
    return this.invitationsService.reissue(dto.reissueToken);
  }
}
