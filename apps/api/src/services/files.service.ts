import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { SupabaseStorageService } from './supabase-storage.service';
import type { CurrentUserData } from '../decorators/current-user.decorator';

const BUCKET = 'agent_assets';
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
const ALLOWED_PURPOSES = ['header-logo', 'bot-avatar', 'user-avatar', 'icon-image', 'brand-logo'];

export interface UploadAgentAssetParams {
  agentId: string;
  purpose: string;
  user: CurrentUserData;
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
  ) {}

  async uploadAgentAsset(
    file: Express.Multer.File,
    params: UploadAgentAssetParams,
  ) {
    const { agentId, purpose, user } = params;

    // Validate purpose
    if (!ALLOWED_PURPOSES.includes(purpose)) {
      throw new BadRequestException(`Invalid purpose: ${purpose}`);
    }

    // Validate file
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('File size exceeds 2MB limit');
    }
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type: ${file.mimetype}. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }

    // Ensure agent access
    const agent = await this.ensureAgentAccess(agentId, user);

    // Find the agent theme to use as entityId
    const theme = await this.prisma.agentTheme.findUnique({
      where: { agentId },
      select: { id: true },
    });
    const entityId = theme?.id ?? agentId;

    // Delete previous file with same entity + purpose (replace pattern)
    await this.deletePreviousFile(entityId, purpose);

    // Build storage key
    const timestamp = Date.now();
    const safeFileName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `${agent.organizationId}/${agentId}/${purpose}/${timestamp}-${safeFileName}`;

    // Upload to Supabase Storage
    const publicUrl = await this.storage.upload(
      BUCKET,
      storageKey,
      file.buffer,
      file.mimetype,
    );

    // Create File record
    const fileRecord = await this.prisma.file.create({
      data: {
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey,
        publicUrl,
        bucket: BUCKET,
        entityType: 'agent-theme',
        entityId,
        purpose,
        organizationId: agent.organizationId,
        uploadedById: user.id,
      },
    });

    this.logger.log(
      `File uploaded: ${fileRecord.id} for agent ${agentId} (${purpose})`,
    );

    return {
      id: fileRecord.id,
      publicUrl: fileRecord.publicUrl,
      fileName: fileRecord.fileName,
      purpose: fileRecord.purpose,
    };
  }

  async deleteFile(fileId: string, agentId: string, user: CurrentUserData) {
    await this.ensureAgentAccess(agentId, user);

    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    // Remove from storage
    await this.storage.remove(file.bucket, [file.storageKey]);

    // Delete DB record
    await this.prisma.file.delete({ where: { id: fileId } });

    this.logger.log(`File deleted: ${fileId}`);
  }

  private async deletePreviousFile(entityId: string, purpose: string) {
    const existing = await this.prisma.file.findFirst({
      where: {
        entityType: 'agent-theme',
        entityId,
        purpose,
      },
    });

    if (existing) {
      await this.storage.remove(existing.bucket, [existing.storageKey]);
      await this.prisma.file.delete({ where: { id: existing.id } });
      this.logger.log(`Replaced previous file: ${existing.id} (${purpose})`);
    }
  }

  private async ensureAgentAccess(agentId: string, user: CurrentUserData) {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id: agentId,
        deletedAt: null,
        ...(user.role === Role.CLIENT && {
          organizationId: user.organizationId!,
        }),
      },
    });

    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    return agent;
  }
}
