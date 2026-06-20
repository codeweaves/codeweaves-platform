import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { updateDataFieldsSchema, type UpdateDataFieldsDto } from '@repo/validation';

import {
  CurrentUser,
  type CurrentUserData,
} from '../../decorators/current-user.decorator';
import { Roles } from '../../decorators/roles.decorator';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { AgentDataFieldsService } from '../../services/agent-data-fields.service';

/**
 * Per-agent "data capture" configuration: the list of fields a bot should
 * collect from conversations, plus read access to the captured values.
 *
 * Auth: the global JwtAuthGuard + RolesGuard apply. Unlike the knowledge
 * controller, these endpoints carry explicit @Roles AND the service org-scopes
 * CLIENT users — because the collected values are PII (emails/phones) and must
 * never cross tenants.
 */
@ApiTags('Agents')
@Controller('agents/:agentId/data-fields')
export class AgentDataFieldsController {
  constructor(private readonly dataFieldsService: AgentDataFieldsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
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
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
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
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @ApiOperation({
    summary: 'List captured data for the agent (most recent first).',
  })
  @ApiParam({ name: 'agentId', description: 'Agent UUID' })
  @ApiResponse({ status: 200, description: 'Captured data rows.' })
  @ApiResponse({ status: 404, description: 'Agent not found.' })
  async collected(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.dataFieldsService.listCollectedData(agentId, user);
  }
}
