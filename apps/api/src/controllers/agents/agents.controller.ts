import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AgentsService } from '../../services/agents.service';
import { AgentThemesService } from '../../services/agent-themes.service';
import { AgentKnowledgeService } from '../../services/agent-knowledge.service';
import { Roles } from '../../decorators/roles.decorator';
import { RequirePermission } from '../../decorators/require-permission.decorator';
import { RolesGuard } from '../../guards/roles.guard';
import { Resource, Action } from '../../common/rbac/rbac.types';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { CurrentUser, CurrentUserData } from '../../decorators/current-user.decorator';
import {
  createAgentSchema,
  updateAgentSchema,
  agentListQuerySchema,
  updateWebhookSchema,
} from '../../models/agent.dto';
import type {
  CreateAgentDto,
  UpdateAgentDto,
  AgentListQuery,
  UpdateWebhookDto,
} from '../../models/agent.dto';

@ApiTags('Agents')
@ApiBearerAuth()
@Controller('agents')
@UseGuards(RolesGuard)
export class AgentsController {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly themesService: AgentThemesService,
    private readonly knowledgeService: AgentKnowledgeService,
  ) {}

  @Post()
  @RequirePermission(Resource.Agent, Action.Create)
  @ApiOperation({ summary: 'Create a new agent' })
  @ApiResponse({ status: 201, description: 'Agent created' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - ADMIN or SUPER_ADMIN only' })
  async create(
    @Body(new ZodValidationPipe(createAgentSchema)) dto: CreateAgentDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.agentsService.create(dto, user);
  }

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @ApiOperation({ summary: 'List agents' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by agent name' })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'INACTIVE'], description: 'Filter by status' })
  @ApiQuery({ name: 'organizationId', required: false, type: String, description: 'Filter by organization (ADMIN/SUPER_ADMIN only)' })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['name', 'createdAt', 'updatedAt'], description: 'Sort field (default: createdAt)' })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'], description: 'Sort order (default: desc)' })
  @ApiResponse({ status: 200, description: 'Paginated list of agents' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(
    @Query(new ZodValidationPipe(agentListQuerySchema)) query: AgentListQuery,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.agentsService.findAll(query, user);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @ApiOperation({ summary: 'Get agent by ID' })
  @ApiParam({ name: 'id', description: 'Agent UUID' })
  @ApiResponse({ status: 200, description: 'Agent details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.agentsService.findById(id, user);
  }

  /**
   * Bundled GET used by the admin agent-editor page so a single render doesn't
   * have to fan out 4 parallel requests (agent + webhook + theme + knowledge).
   *
   * Why bundle here and not unify the standalone endpoints:
   *   - `/theme` is also consumed by the public widget embed (no auth). Keep it.
   *   - `/webhook`, `/knowledge`, `/:id` have their own permission surfaces
   *     and PATCH round-trips. Keep them for non-editor callers.
   *   - This endpoint is a VIEW on top of them, not a replacement.
   *
   * Composition — all four fetches run in parallel via Promise.allSettled so
   * a missing theme/knowledge/webhook row doesn't fail the whole request. The
   * agent itself is required; if it 404s we re-throw so the page can show the
   * "not found" state.
   *
   * Admin-gated because the payload includes the webhook URL (sensitive field
   * not exposed to CLIENT users).
   */
  @Get(':id/editor-config')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Bundled agent + webhook + theme + knowledge for the admin editor',
  })
  @ApiParam({ name: 'id', description: 'Agent UUID' })
  @ApiResponse({
    status: 200,
    description:
      'Editor-ready configuration bundle. Missing sub-resources return null (e.g. knowledge: null when no record exists).',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN or SUPER_ADMIN only' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async getEditorConfig(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    // Always resolve the agent first — no point fetching sub-resources if the
    // agent itself 404s, and `findById` carries the auth-scoped error.
    const agent = await this.agentsService.findById(id, user);

    const [webhookResult, themeResult, knowledgeResult] = await Promise.allSettled([
      this.agentsService.getWebhookUrl(id, user),
      this.themesService.getTheme(id, user),
      this.knowledgeService.get(id),
    ]);

    return {
      agent,
      // Webhook: swallow any error (e.g. no secret row) — surface as null.
      webhookUrl:
        webhookResult.status === 'fulfilled' ? webhookResult.value.webhookUrl : null,
      // Theme: null when none yet — widget falls back to defaults client-side.
      theme: themeResult.status === 'fulfilled' ? themeResult.value : null,
      // Knowledge: null when no record. Editor treats null + empty-string the same.
      knowledge: knowledgeResult.status === 'fulfilled' ? knowledgeResult.value : null,
    };
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @ApiOperation({ summary: 'Update an agent' })
  @ApiParam({ name: 'id', description: 'Agent UUID' })
  @ApiResponse({ status: 200, description: 'Agent updated' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateAgentSchema)) dto: UpdateAgentDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.agentsService.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @ApiOperation({ summary: 'Soft-delete an agent' })
  @ApiParam({ name: 'id', description: 'Agent UUID' })
  @ApiResponse({ status: 204, description: 'Agent deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<void> {
    await this.agentsService.softDelete(id, user);
  }

  // ==========================================
  // Webhook Management
  // ==========================================

  @Patch(':id/webhook')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Set agent webhook URL' })
  @ApiParam({ name: 'id', description: 'Agent UUID' })
  @ApiResponse({ status: 200, description: 'Webhook URL updated' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - ADMIN or SUPER_ADMIN only' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async setWebhook(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateWebhookSchema)) dto: UpdateWebhookDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.agentsService.setWebhookUrl(id, dto.webhookUrl, user);
  }

  @Get(':id/webhook')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get agent webhook URL (decrypted)' })
  @ApiParam({ name: 'id', description: 'Agent UUID' })
  @ApiResponse({ status: 200, description: 'Webhook URL' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - ADMIN or SUPER_ADMIN only' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async getWebhook(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.agentsService.getWebhookUrl(id, user);
  }

  @Post(':id/webhook/test')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Test agent webhook connectivity' })
  @ApiParam({ name: 'id', description: 'Agent UUID' })
  @ApiResponse({ status: 200, description: 'Webhook test result' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - ADMIN or SUPER_ADMIN only' })
  @ApiResponse({ status: 404, description: 'Agent not found or no webhook configured' })
  async testWebhook(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.agentsService.testWebhook(id, user);
  }
}
