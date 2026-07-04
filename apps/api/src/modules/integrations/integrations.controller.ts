import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { z } from 'zod';
import {
  integrationProviderEnum,
  upsertIntegrationSchema,
  type IntegrationProvider,
  type UpsertIntegrationDto,
} from '@repo/validation';

import {
  CurrentUser,
  type CurrentUserData,
} from '../../decorators/current-user.decorator';
import { Roles } from '../../decorators/roles.decorator';
import { RolesGuard } from '../../guards/roles.guard';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';

import { IntegrationsService } from './integrations.service';

const setEnabledSchema = z.object({ enabled: z.boolean() });
type SetEnabledDto = z.infer<typeof setEnabledSchema>;

/**
 * Per-agent third-party integrations (HubSpot, Slack). Connecting runs a live
 * credential test; credentials are stored encrypted and never returned.
 *
 * Tenancy enforced in IntegrationsService via assertAgentAccessible.
 */
@ApiTags('Agent Integrations')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('agents/:agentId/integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @ApiOperation({ summary: 'List connected integrations (credentials masked).' })
  @ApiResponse({ status: 200, description: 'Integrations with masked hints.' })
  async list(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.integrationsService.list(agentId, user);
  }

  @Put(':provider')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Connect or update an integration. Credentials are validated with a live connection test before being stored (encrypted).',
  })
  @ApiResponse({ status: 200, description: 'Integration connected.' })
  @ApiResponse({ status: 400, description: 'Invalid credentials or failed connection test.' })
  async upsert(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('provider', new ZodValidationPipe(integrationProviderEnum))
    provider: IntegrationProvider,
    @Body(new ZodValidationPipe(upsertIntegrationSchema))
    dto: UpsertIntegrationDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.integrationsService.upsert(agentId, provider, dto, user);
  }

  @Post(':provider/test')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-run the connection test with stored credentials.' })
  @ApiResponse({ status: 200, description: '{ ok, message }' })
  async test(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('provider', new ZodValidationPipe(integrationProviderEnum))
    provider: IntegrationProvider,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.integrationsService.test(agentId, provider, user);
  }

  @Patch(':provider')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @ApiOperation({ summary: 'Enable/disable an integration without re-entering credentials.' })
  @ApiResponse({ status: 200, description: 'Integration updated.' })
  async setEnabled(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('provider', new ZodValidationPipe(integrationProviderEnum))
    provider: IntegrationProvider,
    @Body(new ZodValidationPipe(setEnabledSchema)) dto: SetEnabledDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.integrationsService.setEnabled(
      agentId,
      provider,
      dto.enabled,
      user,
    );
  }

  @Delete(':provider')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect an integration (deletes stored credentials).' })
  @ApiResponse({ status: 204, description: 'Integration removed.' })
  async remove(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('provider', new ZodValidationPipe(integrationProviderEnum))
    provider: IntegrationProvider,
    @CurrentUser() user: CurrentUserData,
  ): Promise<void> {
    await this.integrationsService.remove(agentId, provider, user);
  }
}
