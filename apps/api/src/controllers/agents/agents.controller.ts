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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { AgentsService } from '../../services/agents.service';
import { AgentThemesService } from '../../services/agent-themes.service';
import { AgentKnowledgeService } from '../../services/agent-knowledge.service';
import { AgentDataFieldsService } from '../../services/agent-data-fields.service';
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
import { RequirePermission } from '../../decorators/require-permission.decorator';
import { Resource, Action } from '../../common/rbac/rbac.types';
import { PermissionCatalogService } from '../../common/rbac/permission-catalog.service';

@ApiTags('Agents')
@ApiBearerAuth()
@Controller('agents')
export class AgentsController {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly themesService: AgentThemesService,
    private readonly knowledgeService: AgentKnowledgeService,
    private readonly dataFieldsService: AgentDataFieldsService,
    private readonly catalog: PermissionCatalogService,
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
  @RequirePermission(Resource.Agent, Action.Read)
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
  @RequirePermission(Resource.Agent, Action.Read)
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
   * Field-level gating: `webhookUrl` needs `AgentSecret:Read` and `dataFields`
   * needs `AgentDataField:Read`, because both belong to editor sections that are
   * separately grantable roles. Without the permission the caller gets
   * `webhookUrl: null` / `dataFields: []`, mirroring the sidebar, which hides the
   * matching section.
   *
   * Checked per PERMISSION rather than per role — gating on the legacy tier meant
   * an org user holding `org.agent_data_capture` saw the section but received an
   * empty list, while a super admin saw the same agent's fields fine.
   *
   * Tenant scope is enforced by `findById(id, user)` — a foreign agent 404s.
   */
  @Get(':id/editor-config')
  @RequirePermission(Resource.Agent, Action.Read)
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
    // agent itself 404s, and `findById` carries the auth-scoped error (a CLIENT
    // only ever resolves an agent in their own org).
    const agent = await this.agentsService.findById(id, user);

    // Per-PERMISSION, not per-role. These two sub-resources belong to separately
    // grantable editor sections, so gating them on the legacy tier meant an org
    // user holding org.agent_data_capture still received `dataFields: []` and saw
    // an empty section, while a super admin saw the same agent's fields fine.
    const granted = this.catalog.resolvePermissions(user.roleKeys ?? []);
    const canReadWebhook = granted.has('AgentSecret:Read');
    const canReadDataFields = granted.has('AgentDataField:Read');

    // Anything the caller cannot read resolves to null/[] so the sensitive value
    // never reaches them — the same boundary the editor sidebar draws, applied
    // here at the field level.
    const [webhookResult, themeResult, knowledgeResult, dataFieldsResult] =
      await Promise.allSettled([
        canReadWebhook
          ? this.agentsService.getWebhookUrl(id, user)
          : Promise.resolve(null),
        this.themesService.getTheme(id, user),
        this.knowledgeService.get(id, user),
        canReadDataFields
          ? this.dataFieldsService.list(id, user)
          : Promise.resolve([]),
      ]);

    return {
      agent,
      // Webhook: needs AgentSecret:Read; swallow any error (no secret row) → null.
      webhookUrl:
        webhookResult.status === 'fulfilled' && webhookResult.value
          ? webhookResult.value.webhookUrl
          : null,
      // Theme: null when none yet — widget falls back to defaults client-side.
      theme: themeResult.status === 'fulfilled' ? themeResult.value : null,
      // Knowledge: null when no record. Editor treats null + empty-string the same.
      knowledge: knowledgeResult.status === 'fulfilled' ? knowledgeResult.value : null,
      // Data-capture field definitions; empty array without AgentDataField:Read.
      dataFields:
        dataFieldsResult.status === 'fulfilled' ? dataFieldsResult.value : [],
    };
  }

  @Patch(':id')
  @RequirePermission(Resource.Agent, Action.Update)
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
  @RequirePermission(Resource.Agent, Action.Delete)
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
  @RequirePermission(Resource.AgentSecret, Action.Update)
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
  @RequirePermission(Resource.AgentSecret, Action.Read)
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
  @RequirePermission(Resource.AgentSecret, Action.Update)
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
