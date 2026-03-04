import {
  Controller,
  Get,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { AnalyticsService } from '../../services/analytics.service';
import { Roles } from '../../decorators/roles.decorator';
import { RolesGuard } from '../../guards/roles.guard';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { CurrentUser, CurrentUserData } from '../../decorators/current-user.decorator';
import {
  analyticsQuerySchema,
  agentAnalyticsQuerySchema,
} from '../../models/analytics.dto';
import type {
  AnalyticsQuery,
  AgentAnalyticsQuery,
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
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set('Cache-Control', 'private, max-age=300');
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
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set('Cache-Control', 'private, max-age=300');
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
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set('Cache-Control', 'private, max-age=300');
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
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set('Cache-Control', 'private, max-age=300');
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
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set('Cache-Control', 'private, max-age=300');
    return this.analyticsService.getAgentMetrics(query, user);
  }
}
