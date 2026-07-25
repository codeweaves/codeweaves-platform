import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  MAX_KNOWLEDGE_UPLOAD_BYTES,
  updateKnowledgeSchema,
  type UpdateKnowledgeDto,
} from '@repo/validation';

import {
  CurrentUser,
  type CurrentUserData,
} from '../../decorators/current-user.decorator';
import { Roles } from '../../decorators/roles.decorator';
import { RolesGuard } from '../../guards/roles.guard';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { AgentKnowledgeService } from '../../services/agent-knowledge.service';

/**
 * Agent knowledge base management (non-RAG: static text prepended to system
 * prompt). Full RAG pipeline (with chunking + embeddings) ships in Phase 3
 * under a different endpoint family.
 *
 * Auth: ADMIN / SUPER_ADMIN / CLIENT. RolesGuard gates the route; the service
 * org-scopes every method via assertAgentAccess, so a CLIENT only ever reaches
 * their own organisation's agents (a foreign agent 404s) — mirrors
 * AgentThemesController / AgentDataFieldsController.
 */
@ApiTags('Agents')
@UseGuards(RolesGuard)
@Controller('agents/:agentId/knowledge')
export class AgentKnowledgeController {
  constructor(private readonly knowledgeService: AgentKnowledgeService) {}

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @ApiOperation({ summary: 'Fetch the agent\'s current knowledge content.' })
  @ApiResponse({ status: 200, description: 'Knowledge record or null.' })
  async get(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.knowledgeService.get(agentId, user);
  }

  @Put()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Set or replace the agent\'s knowledge content (paste raw text directly).',
  })
  @ApiResponse({
    status: 200,
    description: 'Updated knowledge record with computed token count.',
  })
  @ApiResponse({ status: 413, description: 'Content exceeds 500KB limit.' })
  async set(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body(new ZodValidationPipe(updateKnowledgeSchema))
    dto: UpdateKnowledgeDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.knowledgeService.set(agentId, dto, user);
  }

  @Post('extract')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Extract text from a file (PDF/DOCX/TXT/MD) WITHOUT saving. Returns the text for preview/edit in the UI. Use PUT /knowledge to actually save the (possibly-edited) text.',
  })
  @ApiResponse({
    status: 200,
    description: 'Extracted text returned; NOT persisted.',
  })
  @ApiResponse({ status: 400, description: 'File empty or extraction failed.' })
  @ApiResponse({ status: 413, description: 'File or extracted text too large.' })
  @ApiResponse({
    status: 415,
    description: 'Unsupported file type (only PDF, DOCX, TXT, Markdown allowed).',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_KNOWLEDGE_UPLOAD_BYTES },
    }),
  )
  async extract(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.knowledgeService.extractFile(agentId, file, user);
  }

  @Delete()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove the agent\'s knowledge content.' })
  @ApiResponse({ status: 204, description: 'Knowledge removed (or never existed).' })
  async remove(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<void> {
    await this.knowledgeService.remove(agentId, user);
  }
}
