import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { updateDataFieldsSchema, type UpdateDataFieldsDto } from '@repo/validation';

import {
  CurrentUser,
  type CurrentUserData,
} from '../../decorators/current-user.decorator';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { AgentDataFieldsService } from '../../services/agent-data-fields.service';
import { RequirePermission } from '../../decorators/require-permission.decorator';
import { Resource, Action } from '../../common/rbac/rbac.types';

/**
 * Per-agent "data capture" configuration: the list of fields a bot should
 * collect from conversations, plus read access to the captured values.
 *
 * Auth: ADMIN / SUPER_ADMIN only — clients never see or touch data capture
 * (the editor section is admin-only too). The service still org-scopes by role
 * as defense-in-depth, but CLIENT is blocked at the route. Collected values are
 * PII (emails/phones), so this stays platform-staff-only.
 */
@ApiTags('Agents')
@Controller('agents/:agentId/data-fields')
export class AgentDataFieldsController {
  constructor(private readonly dataFieldsService: AgentDataFieldsService) {}

  @Get()
  @RequirePermission(Resource.AgentDataField, Action.Read)
  @ApiOperation({ summary: "List the agent's data-capture field definitions." })
  @ApiParam({ name: 'agentId', description: 'Agent UUID' })
  @ApiResponse({ status: 200, description: 'Ordered list of field definitions.' })
  @ApiResponse({ status: 404, description: 'Agent not found.' })
  async list(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.dataFieldsService.list(agentId, user);
  }

  @Put()
  @RequirePermission(Resource.AgentDataField, Action.Update)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Replace the agent's entire data-capture field list (editor sends the whole list).",
  })
  @ApiParam({ name: 'agentId', description: 'Agent UUID' })
  @ApiResponse({ status: 200, description: 'Updated field list.' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed (e.g. duplicate keys, too many fields).',
  })
  @ApiResponse({ status: 404, description: 'Agent not found.' })
  async replace(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body(new ZodValidationPipe(updateDataFieldsSchema)) dto: UpdateDataFieldsDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.dataFieldsService.replaceAll(agentId, dto, user);
  }

  @Get('collected')
  // Clients CAN read the captured data for their OWN agents (org-scoped in the
  // service). Defining the fields stays admin-only — this read does not.
  @RequirePermission(Resource.CollectedData, Action.Read)
  @ApiOperation({
    summary:
      'Paginated captured-data view for the agent: dynamic columns + rows.',
  })
  @ApiParam({ name: 'agentId', description: 'Agent UUID' })
  @ApiResponse({ status: 200, description: 'Columns + page of captured rows.' })
  @ApiResponse({ status: 404, description: 'Agent not found.' })
  async collected(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @CurrentUser() user: CurrentUserData,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    const parsedPage = page ? parseInt(page, 10) : 1;
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    // Only the "Captured" column is sortable; everything else defaults to
    // newest-first. Anything other than an explicit 'asc' falls back to 'desc'.
    const order = sortOrder === 'asc' ? 'asc' : 'desc';
    return this.dataFieldsService.getCollectedDataView(
      agentId,
      user,
      Number.isFinite(parsedPage) ? parsedPage : 1,
      Number.isFinite(parsedLimit as number) ? parsedLimit : undefined,
      order,
    );
  }

  /**
   * Stream every captured row for the agent as a CSV download.
   *
   * Same `CollectedData:Read` gate as the table: whoever may page through this
   * data may take it with them. The export is still audit-logged
   * (`COLLECTED_DATA_EXPORTED`) because bulk PII leaving the platform is what a
   * DPDP/GDPR auditor asks about.
   *
   * `@Res()` with manual writes (not a returned value) because the body is
   * generated in batches — a 50k-row export must never be assembled in memory.
   * `write()` is awaited on backpressure so a slow client throttles the reads
   * instead of filling the socket buffer.
   */
  @Get('collected/export')
  @RequirePermission(Resource.CollectedData, Action.Read)
  @ApiOperation({
    summary: 'Download every captured row for the agent as a CSV file.',
  })
  @ApiParam({ name: 'agentId', description: 'Agent UUID' })
  @ApiResponse({ status: 200, description: 'CSV attachment.' })
  @ApiResponse({ status: 404, description: 'Agent not found.' })
  async exportCollected(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @CurrentUser() user: CurrentUserData,
    @Res() res: Response,
    @Query('sortOrder') sortOrder?: string,
    @Query('tz') tz?: string,
  ): Promise<void> {
    const order = sortOrder === 'asc' ? 'asc' : 'desc';
    // No page/limit: the export is the whole set. `tz` is the caller's IANA
    // zone, validated (and defaulted to UTC) in the service.
    // Throws (and renders as JSON) before any header is written.
    const { filename, stream } =
      await this.dataFieldsService.prepareCollectedDataExport(
        agentId,
        user,
        order,
        tz,
      );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // PII: never let a proxy or the browser keep a copy.
    res.setHeader('Cache-Control', 'no-store');

    const write = (chunk: string) =>
      new Promise<void>((resolve) => {
        if (res.write(chunk)) resolve();
        else res.once('drain', resolve);
      });

    for await (const chunk of stream) {
      if (res.writableEnded) break; // client hung up
      await write(chunk);
    }
    res.end();
  }
}
