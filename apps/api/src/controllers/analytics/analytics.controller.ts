import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AnalyticsService } from '../../services/analytics.service';
import { Roles } from '../../decorators/roles.decorator';
import { RolesGuard } from '../../guards/roles.guard';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { CurrentUser, CurrentUserData } from '../../decorators/current-user.decorator';
import {
  analyticsQuerySchema,
  agentAnalyticsQuerySchema,
  exportLogBodySchema,
} from '../../models/analytics.dto';
import type {
  AnalyticsQuery,
  AgentAnalyticsQuery,
  ExportLogBody,
} from '../../models/analytics.dto';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Get KPI summary data' })
  @ApiQuery({ name: 'startDate', required: true, type: String, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'endDate', required: true, type: String, description: 'End date (ISO 8601)' })
  @ApiQuery({ name: 'agentId', required: false, type: String, description: 'Filter by agent ID' })
  @ApiQuery({ name: 'orgId', required: false, type: String, description: 'Filter by organization (ADMIN/SUPER_ADMIN only)' })
  @ApiResponse({ status: 200, description: 'KPI summary data' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getSummary(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getSummary(query, user);
  }

  @Get('charts/conversations')
  @ApiOperation({ summary: 'Get daily conversation counts' })
  @ApiQuery({ name: 'startDate', required: true, type: String, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'endDate', required: true, type: String, description: 'End date (ISO 8601)' })
  @ApiQuery({ name: 'agentId', required: false, type: String, description: 'Filter by agent ID' })
  @ApiQuery({ name: 'orgId', required: false, type: String, description: 'Filter by organization (ADMIN/SUPER_ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Daily conversation chart data' })
  async getConversationsChart(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getConversationsChart(query, user);
  }

  @Get('charts/response-times')
  @ApiOperation({ summary: 'Get response time distribution' })
  @ApiQuery({ name: 'startDate', required: true, type: String, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'endDate', required: true, type: String, description: 'End date (ISO 8601)' })
  @ApiQuery({ name: 'agentId', required: false, type: String, description: 'Filter by agent ID' })
  @ApiQuery({ name: 'orgId', required: false, type: String, description: 'Filter by organization (ADMIN/SUPER_ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Response time distribution data' })
  async getResponseTimeDistribution(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getResponseTimeDistribution(query, user);
  }

  @Get('charts/message-volume')
  @ApiOperation({ summary: 'Get message volume heatmap data' })
  @ApiQuery({ name: 'startDate', required: true, type: String, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'endDate', required: true, type: String, description: 'End date (ISO 8601)' })
  @ApiQuery({ name: 'agentId', required: false, type: String, description: 'Filter by agent ID' })
  @ApiQuery({ name: 'orgId', required: false, type: String, description: 'Filter by organization (ADMIN/SUPER_ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Message volume heatmap data' })
  async getMessageVolumeHeatmap(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getMessageVolumeHeatmap(query, user);
  }

  @Get('agents')
  @ApiOperation({ summary: 'Get per-agent analytics metrics' })
  @ApiQuery({ name: 'startDate', required: true, type: String, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'endDate', required: true, type: String, description: 'End date (ISO 8601)' })
  @ApiQuery({ name: 'agentId', required: false, type: String, description: 'Filter by agent ID' })
  @ApiQuery({ name: 'orgId', required: false, type: String, description: 'Filter by organization (ADMIN/SUPER_ADMIN only)' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20)' })
  @ApiQuery({ name: 'sortBy', required: false, type: String, description: 'Sort field' })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'], description: 'Sort order' })
  @ApiResponse({ status: 200, description: 'Paginated per-agent metrics' })
  async getAgentMetrics(
    @Query(new ZodValidationPipe(agentAnalyticsQuerySchema)) query: AgentAnalyticsQuery,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getAgentMetrics(query, user);
  }

  // ==========================================
  // Conversation Classification & Channel Endpoints
  // ==========================================

  @Get('conversations/categories')
  @ApiOperation({ summary: 'Get conversation distribution by AI-classified category' })
  @ApiQuery({ name: 'startDate', required: true, type: String, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'endDate', required: true, type: String, description: 'End date (ISO 8601)' })
  @ApiQuery({ name: 'agentId', required: false, type: String, description: 'Filter by agent ID' })
  @ApiQuery({ name: 'orgId', required: false, type: String, description: 'Filter by organization (ADMIN/SUPER_ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Category distribution with uncategorized count' })
  async getConversationCategories(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getConversationCategories(query, user);
  }

  @Get('conversations/languages')
  @ApiOperation({ summary: 'Get conversation distribution by detected language (all conversations)' })
  @ApiQuery({ name: 'startDate', required: true, type: String, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'endDate', required: true, type: String, description: 'End date (ISO 8601)' })
  @ApiQuery({ name: 'agentId', required: false, type: String, description: 'Filter by agent ID' })
  @ApiQuery({ name: 'orgId', required: false, type: String, description: 'Filter by organization (ADMIN/SUPER_ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Language distribution data' })
  async getConversationLanguages(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getConversationLanguages(query, user);
  }

  @Get('conversations/channels')
  @ApiOperation({ summary: 'Get conversation volume split by channel/source' })
  @ApiQuery({ name: 'startDate', required: true, type: String, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'endDate', required: true, type: String, description: 'End date (ISO 8601)' })
  @ApiQuery({ name: 'agentId', required: false, type: String, description: 'Filter by agent ID' })
  @ApiQuery({ name: 'orgId', required: false, type: String, description: 'Filter by organization (ADMIN/SUPER_ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Channel/source distribution data' })
  async getConversationChannels(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getConversationChannels(query, user);
  }

  // ==========================================
  // Voice Analytics Endpoints (Story 10-14)
  // ==========================================

  @Get('voice/summary')
  @ApiOperation({ summary: 'Get voice analytics summary (voice vs text ratio, latencies, errors)' })
  @ApiQuery({ name: 'startDate', required: true, type: String, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'endDate', required: true, type: String, description: 'End date (ISO 8601)' })
  @ApiQuery({ name: 'agentId', required: false, type: String, description: 'Filter by agent ID' })
  @ApiQuery({ name: 'orgId', required: false, type: String, description: 'Filter by organization (ADMIN/SUPER_ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Voice analytics summary' })
  async getVoiceSummary(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getVoiceSummary(query, user);
  }

  @Get('voice/languages')
  @ApiOperation({ summary: 'Get voice language distribution for pie chart' })
  @ApiQuery({ name: 'startDate', required: true, type: String, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'endDate', required: true, type: String, description: 'End date (ISO 8601)' })
  @ApiQuery({ name: 'agentId', required: false, type: String, description: 'Filter by agent ID' })
  @ApiQuery({ name: 'orgId', required: false, type: String, description: 'Filter by organization (ADMIN/SUPER_ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Language distribution data' })
  async getLanguageDistribution(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getLanguageDistribution(query, user);
  }

  @Get('voice/latency')
  @ApiOperation({ summary: 'Get per-provider voice latency breakdown (P50, P95, avg)' })
  @ApiQuery({ name: 'startDate', required: true, type: String, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'endDate', required: true, type: String, description: 'End date (ISO 8601)' })
  @ApiQuery({ name: 'agentId', required: false, type: String, description: 'Filter by agent ID' })
  @ApiQuery({ name: 'orgId', required: false, type: String, description: 'Filter by organization (ADMIN/SUPER_ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Voice latency per provider' })
  async getVoiceLatencyByProvider(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getVoiceLatencyByProvider(query, user);
  }

  @Post('export-log')
  @ApiOperation({ summary: 'Log an analytics data export action' })
  @ApiResponse({ status: 201, description: 'Export logged successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async logExport(
    @Body(new ZodValidationPipe(exportLogBodySchema)) body: ExportLogBody,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.logExport(body, user);
  }
}
