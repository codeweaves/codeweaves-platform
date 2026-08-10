import {
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { ConversationsService } from '../../services/conversations.service';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { CurrentUser, CurrentUserData } from '../../decorators/current-user.decorator';
import {
  conversationsListQuerySchema,
  conversationDetailParamsSchema,
} from '../../models/conversations.dto';
import type {
  ConversationsListQuery,
  ConversationDetailParams,
} from '../../models/conversations.dto';
import { RequirePermission } from '../../decorators/require-permission.decorator';
import { Resource, Action } from '../../common/rbac/rbac.types';

@ApiTags('Conversations')
@ApiBearerAuth()
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  @ApiOperation({ summary: 'List chat sessions (paginated, filterable)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'agentId', required: false, type: String })
  @ApiQuery({ name: 'agentIds', required: false, type: String, description: 'Comma-separated UUIDs' })
  @ApiQuery({ name: 'orgId', required: false, type: String, description: 'Filter by organization (ADMIN/SUPER_ADMIN only)' })
  @ApiQuery({ name: 'source', required: false, enum: ['WIDGET', 'WHATSAPP', 'DEMO'] })
  @ApiQuery({ name: 'sources', required: false, type: String, description: 'Comma-separated sources' })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'EXPIRED'] })
  @ApiQuery({ name: 'statuses', required: false, type: String, description: 'Comma-separated statuses' })
  @ApiQuery({ name: 'categories', required: false, type: String, description: 'Comma-separated category names assigned by the background classifier' })
  @ApiQuery({ name: 'visitorId', required: false, type: String })
  @ApiQuery({ name: 'from', required: false, type: String, description: 'ISO datetime (inclusive lower bound on createdAt)' })
  @ApiQuery({ name: 'to', required: false, type: String, description: 'ISO datetime (inclusive upper bound on createdAt)' })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['lastMessageAt', 'createdAt', 'messageCount'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiResponse({ status: 200, description: 'Paginated list of chat sessions' })
  @RequirePermission(Resource.ChatSession, Action.Read)
  async list(
    @Query(new ZodValidationPipe(conversationsListQuerySchema)) query: ConversationsListQuery,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.conversationsService.list(query, user);
  }

  @Get(':sessionId')
  @ApiOperation({ summary: 'Get full transcript + traces for a single session' })
  @ApiParam({ name: 'sessionId', type: String, description: 'Public session ID (ChatSession.sessionId)' })
  @ApiResponse({ status: 200, description: 'Session detail with messages and traces' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  @RequirePermission(Resource.ChatSession, Action.Read)
  async getOne(
    @Param(new ZodValidationPipe(conversationDetailParamsSchema)) params: ConversationDetailParams,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.conversationsService.getBySessionId(params.sessionId, user);
  }
}
