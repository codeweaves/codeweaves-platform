import {
  Controller,
  Post,
  Delete,
  Param,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiParam, ApiConsumes } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { FilesService, MAX_FILE_SIZE } from '../../services/files.service';
import { Roles } from '../../decorators/roles.decorator';
import { RolesGuard } from '../../guards/roles.guard';
import { CurrentUser, CurrentUserData } from '../../decorators/current-user.decorator';

@ApiTags('Agent Files')
@ApiBearerAuth()
@Controller('agents/:id/files')
@UseGuards(RolesGuard)
export class AgentFilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @UseInterceptors(
    // Cap the upload at the handler boundary so multer stops buffering once the
    // limit is hit, instead of reading an unbounded multipart body into memory
    // before the in-service size check runs (heap-exhaustion DoS).
    FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file for an agent' })
  @ApiParam({ name: 'id', description: 'Agent UUID' })
  @ApiResponse({ status: 201, description: 'File uploaded' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async uploadFile(
    @Param('id', ParseUUIDPipe) agentId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('purpose') purpose: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    if (!purpose) {
      throw new BadRequestException('purpose field is required');
    }

    return this.filesService.uploadAgentAsset(file, {
      agentId,
      purpose,
      user,
    });
  }

  @Delete(':fileId')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @ApiOperation({ summary: 'Delete an agent file' })
  @ApiParam({ name: 'id', description: 'Agent UUID' })
  @ApiParam({ name: 'fileId', description: 'File UUID' })
  @ApiResponse({ status: 200, description: 'File deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async deleteFile(
    @Param('id', ParseUUIDPipe) agentId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    await this.filesService.deleteFile(fileId, agentId, user);
    return { success: true };
  }
}
