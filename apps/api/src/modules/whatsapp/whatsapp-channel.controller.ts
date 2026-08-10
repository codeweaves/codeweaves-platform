import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
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

import {
  CurrentUser,
  CurrentUserData,
} from '../../decorators/current-user.decorator';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';

import {
  connectWhatsappChannelSchema,
  updateWhatsappChannelSchema,
  type ConnectWhatsappChannelDto,
  type UpdateWhatsappChannelDto,
} from './whatsapp-channel.dto';
import { WhatsappChannelService } from './whatsapp-channel.service';
import { Resource, Action } from '../../common/rbac/rbac.types';
import { RequirePermission } from '../../decorators/require-permission.decorator';

/**
 * Dashboard endpoints to connect / inspect / disconnect an agent's WhatsApp
 * number. Authenticated (global JWT guard) + RBAC (global PermissionGuard + RequirePermission).
 * Authorization that the agent belongs to the caller's org is enforced in the
 * service via AgentsService.findById.
 *
 * Reuses Resource.Agent permissions — connecting WhatsApp is configuring the agent.
 */
@ApiTags('WhatsApp Channel')
@ApiBearerAuth()
@Controller('agents/:agentId/whatsapp')
export class WhatsappChannelController {
  constructor(private readonly channelService: WhatsappChannelService) {}

  @Get()
  @RequirePermission(Resource.Agent, Action.Read)
  @ApiOperation({ summary: "Get the agent's WhatsApp channel (null if none)" })
  @ApiParam({ name: 'agentId', description: 'Agent UUID' })
  @ApiResponse({ status: 200, description: 'Channel details or null' })
  async get(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.channelService.getByAgent(agentId, user);
  }

  @Post()
  @RequirePermission(Resource.Agent, Action.Update)
  @ApiOperation({ summary: 'Connect (or re-connect) a WhatsApp number' })
  @ApiParam({ name: 'agentId', description: 'Agent UUID' })
  @ApiResponse({ status: 201, description: 'Channel connected' })
  @ApiResponse({ status: 409, description: 'Number already connected to another agent' })
  async connect(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Body(new ZodValidationPipe(connectWhatsappChannelSchema))
    dto: ConnectWhatsappChannelDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.channelService.connect(agentId, dto, user);
  }

  @Patch()
  @RequirePermission(Resource.Agent, Action.Update)
  @ApiOperation({ summary: 'Update channel settings (e.g. voice-reply toggle)' })
  @ApiParam({ name: 'agentId', description: 'Agent UUID' })
  @ApiResponse({ status: 200, description: 'Channel updated' })
  @ApiResponse({ status: 404, description: 'No channel connected' })
  async update(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Body(new ZodValidationPipe(updateWhatsappChannelSchema))
    dto: UpdateWhatsappChannelDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.channelService.setVoiceReply(agentId, dto, user);
  }

  @Delete()
  @RequirePermission(Resource.Agent, Action.Update)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect the WhatsApp number' })
  @ApiParam({ name: 'agentId', description: 'Agent UUID' })
  @ApiResponse({ status: 204, description: 'Channel disconnected' })
  async disconnect(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<void> {
    await this.channelService.disconnect(agentId, user);
  }
}
