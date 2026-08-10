import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { HandoverService } from '../../services/handover.service';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { CurrentUser, CurrentUserData } from '../../decorators/current-user.decorator';
import {
  handoverInboxQuerySchema,
  handoverSessionParamsSchema,
  handoverMessageSchema,
} from '../../models/handover.dto';
import type {
  HandoverInboxQuery,
  HandoverSessionParams,
  HandoverMessageDto,
} from '../../models/handover.dto';
import { RequirePermission } from '../../decorators/require-permission.decorator';
import { Resource, Action } from '../../common/rbac/rbac.types';

/**
 * Live human-handover Inbox. Any client-side user who owns the bot can take
 * over (no role gating beyond org scoping — the client side has no roles).
 *
 * Route order matters: the literal `inbox` path is declared before the
 * `:sessionId` param route so `/handover/inbox` isn't swallowed as a sessionId.
 */
@ApiTags('Handover')
@ApiBearerAuth()
@Controller('handover')
export class HandoverController {
  constructor(private readonly handover: HandoverService) {}

  @Get('inbox')
  @ApiOperation({ summary: 'List conversations needing a human / being handled' })
  @ApiQuery({ name: 'filter', required: false, enum: ['needs', 'handling', 'all'] })
  @ApiQuery({ name: 'agentId', required: false, type: String })
  @ApiQuery({ name: 'orgId', required: false, type: String, description: 'ADMIN/SUPER_ADMIN only' })
  @ApiResponse({ status: 200, description: 'Inbox list' })
  @RequirePermission(Resource.Handover, Action.Read)
  async inbox(
    @Query(new ZodValidationPipe(handoverInboxQuerySchema)) query: HandoverInboxQuery,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.handover.listInbox(query, user);
  }

  @Get('enabled')
  @ApiOperation({ summary: 'Whether any in-scope bot has human takeover on (nav gating)' })
  @ApiResponse({ status: 200, description: '{ enabled: boolean }' })
  @RequirePermission(Resource.Handover, Action.Read)
  async enabled(@CurrentUser() user: CurrentUserData) {
    return this.handover.handoverEnabled(user);
  }

  @Get(':sessionId')
  @ApiOperation({ summary: 'Get a conversation thread + handover state' })
  @ApiParam({ name: 'sessionId', type: String })
  @ApiResponse({ status: 200, description: 'Thread' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  @RequirePermission(Resource.Handover, Action.Read)
  async thread(
    @Param(new ZodValidationPipe(handoverSessionParamsSchema)) params: HandoverSessionParams,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.handover.getThread(params.sessionId, user);
  }

  @Post(':sessionId/takeover')
  @HttpCode(200)
  @ApiOperation({ summary: 'Take over the conversation (pauses the AI)' })
  @ApiResponse({ status: 200, description: 'Updated thread' })
  @RequirePermission(Resource.Handover, Action.Take)
  async takeover(
    @Param(new ZodValidationPipe(handoverSessionParamsSchema)) params: HandoverSessionParams,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.handover.takeover(params.sessionId, user);
  }

  @Post(':sessionId/messages')
  @HttpCode(201)
  @ApiOperation({ summary: 'Send a human reply (must have taken over)' })
  @ApiResponse({ status: 201, description: 'Message created' })
  @ApiResponse({ status: 409, description: 'Not handling this conversation' })
  @RequirePermission(Resource.Handover, Action.Reply)
  async message(
    @Param(new ZodValidationPipe(handoverSessionParamsSchema)) params: HandoverSessionParams,
    @Body(new ZodValidationPipe(handoverMessageSchema)) dto: HandoverMessageDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.handover.postMessage(params.sessionId, user, dto.content);
  }

  @Post(':sessionId/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve — hand control back to the AI' })
  @ApiResponse({ status: 200, description: 'Updated thread' })
  @RequirePermission(Resource.Handover, Action.Resolve)
  async resolve(
    @Param(new ZodValidationPipe(handoverSessionParamsSchema)) params: HandoverSessionParams,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.handover.resolve(params.sessionId, user);
  }
}
