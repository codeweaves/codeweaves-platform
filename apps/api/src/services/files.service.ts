import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { File as FileRow, Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { ObjectStorageService } from "./object-storage.service";
import { AppLogger } from "../common/logger/app-logger";
import { TracerService } from "../common/tracer/tracer.service";
import { InternalEventLogger } from "../common/events/internal.logger";
import type { CurrentUserData } from "../decorators/current-user.decorator";
import { isOrgScoped } from "../utils/tenant-filter";

// Key prefix for agent branding images inside the storage bucket.
const KEY_PREFIX = "agent-assets";
export const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
// Raster image types only. SVG is deliberately excluded: it is an active
// document (can carry <script>) and, served inline from the public bucket,
// yields stored XSS in the storage origin on direct navigation.
const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];
const ALLOWED_PURPOSES = [
  "header-logo",
  "bot-avatar",
  "user-avatar",
  "icon-image",
  "brand-logo",
];

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
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // GIF: "GIF87a" / "GIF89a"
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return "image/gif";
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
    return "image/webp";
  }

  return null;
}

/**
 * Uploads no saved theme uses are deleted by the daily cleanup once they are
 * this old. Long enough that an editor left open overnight, or over a weekend,
 * still saves fine. A save that adds an upload the cleanup already deleted is
 * refused (assertNewUploadsExist), so a live theme never points at nothing.
 */
export const ORPHAN_FILE_GRACE_DAYS = 7;
/** Files the daily cleanup reads per batch. */
const ORPHAN_CLEANUP_BATCH = 200;
/** A run stops starting new batches after this long; the next run continues. */
const ORPHAN_CLEANUP_BUDGET_MS = 25_000;
/**
 * The release transaction holds the agent lock while storage deletes the
 * objects, so its timeout must cover one storage call (two 15 s attempts at
 * worst). A timeout aborts it with every row kept, which is safe.
 */
const RELEASE_TRANSACTION = { maxWait: 5_000, timeout: 35_000 };

/** Every string anywhere in a theme config (URLs sit at several depths). */
function collectStrings(value: unknown, out: Set<string> = new Set()) {
  if (typeof value === "string") {
    out.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
  return out;
}

export interface FileCleanupResult {
  scanned: number;
  deleted: number;
  failed: number;
}

export interface UploadAgentAssetParams {
  agentId: string;
  purpose: string;
  user: CurrentUserData;
}

@Injectable()
export class FilesService {
  private readonly log = new AppLogger(FilesService.name);
  /** One daily cleanup at a time per instance (see triggerOrphanCleanup). */
  private orphanCleanupRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly tracer: TracerService,
    private readonly internalLog: InternalEventLogger,
  ) {}

  async uploadAgentAsset(
    file: Express.Multer.File,
    params: UploadAgentAssetParams,
  ) {
    const { agentId, purpose, user } = params;
    this.log.debug("uploadAgentAsset", "uploading agent asset", {
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
      throw new BadRequestException("No file provided");
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException("File size exceeds 2MB limit");
    }
    // Sniff the real content type from magic bytes rather than trusting the
    // client-supplied Content-Type. The detected type becomes authoritative for
    // both storage and the DB record, so a spoofed label can't smuggle an
    // active document (e.g. SVG/HTML) past the allowlist.
    const detectedMime = detectImageMime(file.buffer);
    if (!detectedMime || !ALLOWED_MIME_TYPES.includes(detectedMime)) {
      throw new BadRequestException(
        `Unsupported or unverifiable file type. Allowed: ${ALLOWED_MIME_TYPES.join(", ")}`,
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

    // Build storage key
    const timestamp = Date.now();
    const safeFileName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storageKey = `${KEY_PREFIX}/${agent.organizationId}/${agentId}/${purpose}/${timestamp}-${safeFileName}`;

    const publicUrl = await this.storage.upload(
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
        bucket: this.storage.bucket,
        entityType: "agent-theme",
        entityId,
        purpose,
        organizationId: agent.organizationId,
        uploadedById: user.id,
      },
    });

    // The file this one replaces is NOT deleted here: until the theme is
    // saved, the live widget still shows it. A save deletes the files it stops
    // using (removeFilesDroppedFromTheme), and the daily cleanup deletes
    // uploads that were never saved (cleanupOrphanedFiles).

    this.log.info("uploadAgentAsset", "file uploaded", {
      fileId: fileRecord.id,
      agentId,
      purpose,
    });
    await this.tracer.logAuditEvent(
      agentId,
      "AGENT_FILE_UPLOADED",
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
      throw new NotFoundException("File not found");
    }
    if (file.bucket !== this.storage.bucket) {
      throw new ConflictException(
        `This file is in storage bucket "${file.bucket}", which the current storage settings cannot reach. Move it with scripts/copy-files-to-object-storage.ts first.`,
      );
    }

    // Same locked path as the theme cleanup: never deletes a file the saved
    // theme shows, and keeps the row when storage could not delete the object.
    const deleted = await this.releaseUnusedFiles(
      agentId,
      [fileId],
      "DASHBOARD",
    );
    if (deleted.length === 0) {
      const inUse = await this.prisma.file.findUnique({
        where: { id: fileId },
      });
      if (inUse) {
        throw new ServiceUnavailableException(
          "The file is still used by the saved theme, or storage could not delete it. Remove it from the theme and save, or try again.",
        );
      }
    }

    this.log.info("deleteFile", "file deleted", { fileId, agentId });
    await this.tracer.logAuditEvent(
      agentId,
      "AGENT_FILE_DELETED",
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

  /**
   * Inside a theme write, before it is stored: refuse a config that adds one
   * of our upload URLs with no file record for this agent. That happens when
   * the daily cleanup deleted an upload an editor still held unsaved (open for
   * longer than ORPHAN_FILE_GRACE_DAYS), or when a URL from another agent is
   * pasted in. Storing it would ship a broken image to the live widget.
   * Only URLs the write ADDS are checked, so a theme saved before this check
   * existed is never blocked by an old reference.
   */
  async assertNewUploadsExist(
    tx: Prisma.TransactionClient,
    params: {
      agentId: string;
      organizationId: string;
      previousConfig: unknown;
      newConfig: unknown;
    },
  ): Promise<void> {
    const base = this.storage.publicBase;
    if (!base) return;
    const before = collectStrings(params.previousConfig);
    const added = [...collectStrings(params.newConfig)].filter(
      (v) => !before.has(v) && v.startsWith(`${base}/`),
    );
    if (added.length === 0) return;

    const theme = await tx.agentTheme.findUnique({
      where: { agentId: params.agentId },
      select: { id: true },
    });
    const found = await tx.file.findMany({
      where: {
        organizationId: params.organizationId,
        entityType: "agent-theme",
        entityId: { in: theme ? [theme.id, params.agentId] : [params.agentId] },
        publicUrl: { in: added },
      },
      select: { publicUrl: true },
    });
    const known = new Set(found.map((f) => f.publicUrl));
    if (added.some((url) => !known.has(url))) {
      throw new BadRequestException(
        "An uploaded image is no longer available. Upload it again, then save.",
      );
    }
  }

  /**
   * After a theme write: delete the uploaded files the write stopped using
   * (a replaced or removed logo, or every image on a reset).
   *
   * Only URLs the previous config held and the new one does not are
   * candidates, so a file uploaded but not yet saved is never touched here.
   * The delete itself re-checks under the agent lock (releaseUnusedFiles), so
   * a later save that put the URL back keeps the file. Runs after the write
   * committed and never throws: the save already succeeded, and anything left
   * behind is picked up by the daily cleanup.
   */
  async removeFilesDroppedFromTheme(params: {
    agentId: string;
    organizationId: string;
    previousConfig: unknown;
    newConfig: unknown;
    userId: string;
  }): Promise<void> {
    const { agentId, organizationId, userId } = params;
    try {
      const kept = collectStrings(params.newConfig);
      const dropped = [...collectStrings(params.previousConfig)].filter(
        (v) => !kept.has(v),
      );
      if (dropped.length === 0) return;

      const theme = await this.prisma.agentTheme.findUnique({
        where: { agentId },
        select: { id: true },
      });
      // Files are recorded against the theme id, or against the agent id when
      // they were uploaded before the agent's first save created the theme.
      const candidates = await this.prisma.file.findMany({
        where: {
          organizationId,
          entityType: "agent-theme",
          entityId: { in: theme ? [theme.id, agentId] : [agentId] },
          publicUrl: { in: dropped },
        },
        select: { id: true },
      });
      if (candidates.length === 0) return;

      const deleted = await this.releaseUnusedFiles(
        agentId,
        candidates.map((c) => c.id),
        "DASHBOARD",
      );
      for (const f of deleted) {
        await this.tracer.logAuditEvent(
          agentId,
          "AGENT_FILE_DELETED",
          {
            response: {
              fileId: f.id,
              fileName: f.fileName,
              purpose: f.purpose,
              userId,
              reason: "removed_from_theme",
            },
          },
          { organizationId, agentId },
        );
      }
      if (deleted.length > 0) {
        this.log.info("removeFilesDroppedFromTheme", "deleted unused files", {
          agentId,
          deleted: deleted.length,
        });
      }
    } catch (err) {
      this.log.warn(
        "removeFilesDroppedFromTheme",
        "cleanup after theme save failed (left for the daily cleanup)",
        { agentId, err: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  /**
   * Start the daily cleanup in the background and return at once: the
   * scheduler (pg_cron via pg_net) gives up after 5 s, and a run can take
   * longer. Returns false when a run is already going in this instance.
   */
  triggerOrphanCleanup(): boolean {
    if (this.orphanCleanupRunning) return false;
    this.orphanCleanupRunning = true;
    void this.cleanupOrphanedFiles()
      .catch(() => undefined) // logged as FILE_CLEANUP_RUN_FAILED
      .finally(() => {
        this.orphanCleanupRunning = false;
      });
    return true;
  }

  /**
   * Daily cleanup: delete uploads that no saved theme uses and that are older
   * than ORPHAN_FILE_GRACE_DAYS. Catches uploads that were never saved, and
   * anything removeFilesDroppedFromTheme could not delete.
   *
   * Works in batches until none are left or the time budget is spent. Each
   * batch collects the URLs saved themes use ONCE and anti-joins on them, so
   * the cost does not grow with themes x files. Rows in a bucket the current
   * storage config cannot reach (from before a provider move) are skipped:
   * the copy script handles those. A row whose object could not be deleted is
   * moved to the back of the queue (updatedAt refreshed), and one agent's
   * failure only skips that agent's files.
   */
  async cleanupOrphanedFiles(): Promise<FileCleanupResult> {
    const start = Date.now();
    const result: FileCleanupResult = { scanned: 0, deleted: 0, failed: 0 };
    try {
      const bucket = this.storage.bucket;
      const base = this.storage.publicBase;
      if (!bucket || !base) throw new Error("Object storage is not configured");
      const cutoff = new Date(start - ORPHAN_FILE_GRACE_DAYS * 86_400_000);
      const skip: string[] = [];

      while (Date.now() - start < ORPHAN_CLEANUP_BUDGET_MS) {
        const batch = await this.prisma.$queryRaw<
          { id: string; agentId: string }[]
        >`
          WITH used AS (
            SELECT DISTINCT v #>> '{}' AS url
            FROM agent_themes u, jsonb_path_query(u.config, 'strict $.**') AS v
            WHERE jsonb_typeof(v) = 'string'
              AND starts_with(v #>> '{}', ${base})
          )
          SELECT f.id, COALESCE(t."agentId", f."entityId") AS "agentId"
          FROM files f
          LEFT JOIN agent_themes t ON t.id = f."entityId"
          WHERE f."entityType" = 'agent-theme'
            AND f.bucket = ${bucket}
            AND f."createdAt" < ${cutoff}
            AND f.id <> ALL(${skip}::text[])
            AND NOT EXISTS (SELECT 1 FROM used WHERE used.url = f."publicUrl")
          ORDER BY f."updatedAt"
          LIMIT ${ORPHAN_CLEANUP_BATCH}`;
        if (batch.length === 0) break;
        result.scanned += batch.length;

        const byAgent = new Map<string, string[]>();
        for (const row of batch) {
          const ids = byAgent.get(row.agentId) ?? [];
          ids.push(row.id);
          byAgent.set(row.agentId, ids);
        }
        for (const [agentId, ids] of byAgent) {
          let gone = new Set<string>();
          try {
            const deleted = await this.releaseUnusedFiles(
              agentId,
              ids,
              "INTERNAL",
            );
            gone = new Set(deleted.map((f) => f.id));
          } catch (err) {
            // e.g. a theme save held this agent's lock too long. Next run.
            this.log.warn("cleanupOrphanedFiles", "agent skipped this run", {
              agentId,
              files: ids.length,
              err: err instanceof Error ? err.message : String(err),
            });
          }
          result.deleted += gone.size;
          for (const id of ids) if (!gone.has(id)) skip.push(id);
        }
        if (batch.length < ORPHAN_CLEANUP_BATCH) break;
      }
      // Not deleted: storage failed, the agent was skipped, or a save started
      // using the file before the locked re-check. All are retried next run.
      result.failed = result.scanned - result.deleted;

      this.internalLog.logCompleted("FILE_CLEANUP_RUN_COMPLETED", {
        latencyMs: Date.now() - start,
        metadata: { ...result },
      });
      if (result.deleted > 0 || result.failed > 0) {
        this.log.info("cleanupOrphanedFiles", "file cleanup run", {
          ...result,
        });
      }
      return result;
    } catch (err) {
      this.internalLog.logFailed("FILE_CLEANUP_RUN_FAILED", err, {
        metadata: { latencyMs: Date.now() - start, ...result },
      });
      throw err;
    }
  }

  /**
   * Delete the given files of one agent that its saved theme does not use.
   *
   * Everything happens under the agent lock theme writes take
   * (AgentThemesService.lockAgentForThemeWrite): re-read the stored theme,
   * delete the unused objects from storage, then delete the rows of the
   * objects storage confirmed gone. So a save can never start using a file
   * this call is deleting: the save waits for the lock, and then
   * assertNewUploadsExist finds no row and refuses the URL. Only this agent's
   * theme needs checking, because a save may only ADD uploads the agent owns.
   *
   * The order (object, then row) means nothing is ever lost track of: if the
   * process stops or the transaction times out after storage deleted an
   * object, the row is still there, and the next run deletes it (deleting a
   * missing key succeeds). Rows whose object could not be deleted get a fresh
   * updatedAt, so the daily cleanup retries them last. Returns the deleted rows.
   */
  private async releaseUnusedFiles(
    agentId: string,
    fileIds: string[],
    channel: "DASHBOARD" | "INTERNAL",
  ): Promise<FileRow[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM agents WHERE id = ${agentId} FOR NO KEY UPDATE`;
      const rows = await tx.file.findMany({ where: { id: { in: fileIds } } });
      if (rows.length === 0) return [];
      const theme = await tx.agentTheme.findUnique({
        where: { agentId },
        select: { config: true },
      });
      const used = collectStrings(theme?.config);
      const free = rows.filter((r) => !used.has(r.publicUrl));
      if (free.length === 0) return [];

      const byBucket = new Map<string, FileRow[]>();
      for (const f of free) {
        const group = byBucket.get(f.bucket) ?? [];
        group.push(f);
        byBucket.set(f.bucket, group);
      }
      const removedKeys = new Set<string>();
      for (const [bucket, group] of byBucket) {
        // Throws when storage is not configured: the transaction rolls back
        // and every row stays.
        const { removed } = await this.storage.remove(
          bucket,
          group.map((f) => f.storageKey),
          channel,
        );
        removed.forEach((k) => removedKeys.add(k));
      }

      const gone = free.filter((f) => removedKeys.has(f.storageKey));
      const kept = free.filter((f) => !removedKeys.has(f.storageKey));
      if (gone.length > 0) {
        await tx.file.deleteMany({
          where: { id: { in: gone.map((f) => f.id) } },
        });
      }
      if (kept.length > 0) {
        await tx.file.updateMany({
          where: { id: { in: kept.map((f) => f.id) } },
          data: { updatedAt: new Date() },
        });
      }
      return gone;
    }, RELEASE_TRANSACTION);
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
      throw new NotFoundException("Agent not found");
    }

    return agent;
  }
}
