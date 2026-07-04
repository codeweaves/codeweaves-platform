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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  MAX_DOCUMENT_UPLOAD_BYTES,
  ingestUrlSchema,
  type IngestUrlDto,
} from '@repo/validation';

import {
  CurrentUser,
  type CurrentUserData,
} from '../../decorators/current-user.decorator';
import { Roles } from '../../decorators/roles.decorator';
import { RolesGuard } from '../../guards/roles.guard';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';

import { DocumentsService } from './documents.service';

/**
 * Agent RAG knowledge-base documents: upload files / ingest URLs, poll
 * ingestion status, re-index, delete.
 *
 * Auth: global JwtAuthGuard + UserSyncGuard, RolesGuard here; tenancy is
 * enforced in DocumentsService via assertAgentAccessible on EVERY method —
 * CLIENT users can only reach agents in their own organization.
 */
@ApiTags('Agent Documents')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('agents/:agentId/documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @ApiOperation({ summary: 'List the agent\'s knowledge-base documents.' })
  @ApiResponse({ status: 200, description: 'Documents with ingestion status.' })
  async list(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.documentsService.list(agentId, user);
  }

  @Post()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Upload a document (PDF/DOCX/TXT/MD). Text is extracted immediately; chunking + embedding run in the background — poll the list for status.',
  })
  @ApiResponse({ status: 201, description: 'Document created (status PENDING).' })
  @ApiResponse({ status: 400, description: 'File empty / unreadable / over the per-agent cap.' })
  @ApiResponse({ status: 413, description: 'File or extracted text too large.' })
  @ApiResponse({ status: 415, description: 'Unsupported file type.' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_DOCUMENT_UPLOAD_BYTES },
    }),
  )
  async upload(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.documentsService.uploadFile(agentId, file, user);
  }

  @Post('url')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Ingest a public web page into the knowledge base. SSRF-guarded: private/internal addresses and redirects are rejected.',
  })
  @ApiResponse({ status: 201, description: 'Document created (status PENDING).' })
  @ApiResponse({ status: 400, description: 'URL unreachable, private, redirecting, or not text.' })
  async ingestUrl(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body(new ZodValidationPipe(ingestUrlSchema)) dto: IngestUrlDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.documentsService.ingestUrl(agentId, dto, user);
  }

  @Post(':documentId/reindex')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Re-chunk + re-embed a document with the agent\'s current chunking strategy (URL documents are re-fetched).',
  })
  @ApiResponse({ status: 200, description: 'Document re-queued (status PENDING).' })
  async reindex(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.documentsService.reindex(agentId, documentId, user);
  }

  @Delete(':documentId')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a document and all its indexed chunks.' })
  @ApiResponse({ status: 204, description: 'Document deleted.' })
  async remove(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<void> {
    await this.documentsService.remove(agentId, documentId, user);
  }
}
