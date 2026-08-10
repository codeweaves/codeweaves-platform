import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SupabaseStorageService } from './supabase-storage.service';
import { AppLogger } from '../common/logger/app-logger';
import { TracerService } from '../common/tracer/tracer.service';
import type { CurrentUserData } from '../decorators/current-user.decorator';
import { isOrgScoped } from '../utils/tenant-filter';

const BUCKET = 'agent_assets';
export const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
// Raster image types only. SVG is deliberately excluded: it is an active
// document (can carry <script>) and, served inline from the public bucket,
// yields stored XSS in the storage origin on direct navigation.
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const ALLOWED_PURPOSES = ['header-logo', 'bot-avatar', 'user-avatar', 'icon-image', 'brand-logo'];

/**
 * Detect an image's true type from its magic bytes. The client-supplied
 * Content-Type is attacker-controlled and must never be trusted on its own —
 * a `.svg`/`.html` payload can be uploaded under an `image/png` label. Returns
 * the sniffed MIME type, or null if the bytes match no supported raster format.
 */
function detectImageMime(buffer: Buffer): string | null {
  if (!buffer || buffer.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // GIF: "GIF87a" / "GIF89a"
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return 'image/gif';
  }

  // WEBP: "RIFF" .... "WEBP"
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

export interface UploadAgentAssetParams {
  agentId: string;
  purpose: string;
  user: CurrentUserData;
}

@Injectable()
export class FilesService {
  private readonly log = new AppLogger(FilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
    private readonly tracer: TracerService,
  ) {}

  async uploadAgentAsset(
    file: Express.Multer.File,
    params: UploadAgentAssetParams,
  ) {
    const { agentId, purpose, user } = params;
    this.log.debug('uploadAgentAsset', 'uploading agent asset', {
      agentId,
      purpose,
      mimeType: file?.mimetype,
      bytes: file?.size,
    });

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
    // Sniff the real content type from magic bytes rather than trusting the
    // client-supplied Content-Type. The detected type becomes authoritative for
    // both storage and the DB record, so a spoofed label can't smuggle an
    // active document (e.g. SVG/HTML) past the allowlist.
    const detectedMime = detectImageMime(file.buffer);
    if (!detectedMime || !ALLOWED_MIME_TYPES.includes(detectedMime)) {
      throw new BadRequestException(
        `Unsupported or unverifiable file type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
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
      detectedMime,
    );

    // Create File record
    const fileRecord = await this.prisma.file.create({
      data: {
        fileName: file.originalname,
        mimeType: detectedMime,
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

    this.log.info('uploadAgentAsset', 'file uploaded', {
      fileId: fileRecord.id,
      agentId,
      purpose,
    });
    await this.tracer.logAuditEvent(
      agentId,
      'AGENT_FILE_UPLOADED',
      {
        response: {
          fileId: fileRecord.id,
          purpose,
          fileName: fileRecord.fileName,
          sizeBytes: fileRecord.sizeBytes,
          userId: user.id,
        },
      },
      { organizationId: agent.organizationId, agentId },
    );

    return {
      id: fileRecord.id,
      publicUrl: fileRecord.publicUrl,
      fileName: fileRecord.fileName,
      purpose: fileRecord.purpose,
    };
  }

  async deleteFile(fileId: string, agentId: string, user: CurrentUserData) {
    // ensureAgentAccess only proves the caller owns *an* agent in their org —
    // it does NOT tie `fileId` to that agent. Scope the file lookup to the
    // verified agent's org so a caller can't delete another tenant's file by
    // pairing their own agentId with a foreign fileId (cross-tenant IDOR).
    const agent = await this.ensureAgentAccess(agentId, user);

    const file = await this.prisma.file.findFirst({
      where: { id: fileId, organizationId: agent.organizationId },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    // Remove from storage
    await this.storage.remove(file.bucket, [file.storageKey]);

    // Delete DB record
    await this.prisma.file.delete({ where: { id: fileId } });

    this.log.info('deleteFile', 'file deleted', { fileId, agentId });
    await this.tracer.logAuditEvent(
      agentId,
      'AGENT_FILE_DELETED',
      {
        response: {
          fileId,
          fileName: file.fileName,
          purpose: file.purpose,
          userId: user.id,
        },
      },
      { organizationId: agent.organizationId, agentId },
    );
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
      this.log.info('deletePreviousFile', 'replaced previous file', {
        fileId: existing.id,
        purpose,
      });
    }
  }

  private async ensureAgentAccess(agentId: string, user: CurrentUserData) {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id: agentId,
        deletedAt: null,
        ...(isOrgScoped(user) && {
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
