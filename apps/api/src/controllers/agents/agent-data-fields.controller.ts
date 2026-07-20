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
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { updateDataFieldsSchema, type UpdateDataFieldsDto } from '@repo/validation';

import {
  CurrentUser,
  type CurrentUserData,
} from '../../decorators/current-user.decorator';
import { Roles } from '../../decorators/roles.decorator';
import { RolesGuard } from '../../guards/roles.guard';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { AgentDataFieldsService } from '../../services/agent-data-fields.service';

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
@UseGuards(RolesGuard)
@Controller('agents/:agentId/data-fields')
export class AgentDataFieldsController {
  constructor(private readonly dataFieldsService: AgentDataFieldsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
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
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
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
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
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
}
