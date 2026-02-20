import {
  Controller,
  Get,
  Put,
  Patch,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { AgentThemesService } from '../../services/agent-themes.service';
import { Roles } from '../../decorators/roles.decorator';
import { RolesGuard } from '../../guards/roles.guard';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { CurrentUser, CurrentUserData } from '../../decorators/current-user.decorator';
import { widgetThemeSchema, partialWidgetThemeSchema } from '../../models/agent-theme.dto';
import type { WidgetTheme, PartialWidgetTheme } from '../../models/agent-theme.dto';

@ApiTags('Agent Themes')
@ApiBearerAuth()
@Controller('agents/:id/theme')
@UseGuards(RolesGuard)
export class AgentThemesController {
  constructor(private readonly themesService: AgentThemesService) {}

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @ApiOperation({ summary: 'Get agent theme configuration' })
  @ApiParam({ name: 'id', description: 'Agent UUID' })
  @ApiResponse({ status: 200, description: 'Theme configuration with version' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async getTheme(
    @Param('id', ParseUUIDPipe) agentId: string,
    @CurrentUser() user: CurrentUserData,
    @Res({ passthrough: true }) res: Response,
  ) {
    const theme = await this.themesService.getTheme(agentId, user);
    res.setHeader('ETag', `"${theme.version}"`);
    return theme;
  }

  @Put()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @ApiOperation({ summary: 'Replace full agent theme configuration' })
  @ApiParam({ name: 'id', description: 'Agent UUID' })
  @ApiResponse({ status: 200, description: 'Theme updated' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async updateTheme(
    @Param('id', ParseUUIDPipe) agentId: string,
    @Body(new ZodValidationPipe(widgetThemeSchema)) config: WidgetTheme,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.themesService.updateTheme(agentId, config, user);
  }

  @Patch()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @ApiOperation({ summary: 'Partially update agent theme configuration' })
  @ApiParam({ name: 'id', description: 'Agent UUID' })
  @ApiResponse({ status: 200, description: 'Theme patched' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async patchTheme(
    @Param('id', ParseUUIDPipe) agentId: string,
    @Body(new ZodValidationPipe(partialWidgetThemeSchema)) config: PartialWidgetTheme,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.themesService.patchTheme(agentId, config, user);
  }

  @Post('reset')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @ApiOperation({ summary: 'Reset agent theme to defaults' })
  @ApiParam({ name: 'id', description: 'Agent UUID' })
  @ApiResponse({ status: 200, description: 'Theme reset to defaults' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async resetTheme(
    @Param('id', ParseUUIDPipe) agentId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.themesService.resetTheme(agentId, user);
  }
}
