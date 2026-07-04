import { Buffer } from 'node:buffer';
import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { AgentKnowledge } from '@prisma/client';
import {
  KNOWLEDGE_UPLOAD_EXTENSIONS,
  MAX_KNOWLEDGE_TEXT_BYTES,
  MAX_KNOWLEDGE_UPLOAD_BYTES,
  getFileExtension,
  isAllowedKnowledgeMimeType,
  type UpdateKnowledgeDto,
} from '@repo/validation';

import { AgentCacheService } from '../common/cache/agent-cache.service';
import type { CurrentUserData } from '../decorators/current-user.decorator';
import { TokenCounterService } from '../modules/ai/token-counter.service';
import { assertAgentAccessible } from '../utils/agent-access.util';
import { extractDocumentText } from '../utils/document-text.util';

import { PrismaService } from './prisma.service';

/**
 * Shape returned by `extractFile()` — the extracted text plus source metadata.
 * Not persisted; caller decides whether to call `set()` afterward.
 */
export interface ExtractedText {
  content: string;
  contentTokens: number;
  sourceFileName: string | null;
  sourceMimeType: string | null;
  sourceSizeBytes: number;
}

/**
 * AgentKnowledgeService: CRUD + file-text extraction for the non-RAG static
 * knowledge base attached to each agent. See `AgentKnowledge` in schema.
 *
 * Text extraction libraries:
 *   - `pdf-parse` for PDFs (already a dep for Phase 3)
 *   - `mammoth` for DOCX → plain text (already a dep for Phase 3)
 *   - native string decode for .txt / .md
 *
 * We deliberately do NOT persist uploaded files themselves — we extract text
 * once, store it, discard the original bytes. The text is everything the LLM
 * will ever see. If the operator wants to "replace" knowledge, they upload
 * again and we re-extract. This keeps storage costs zero and GDPR trivial.
 *
 * NOT responsible for:
 *   - Caching (AgentCacheService owns that, invalidation triggered here on writes)
 *   - Appending to system prompt at chat time (DirectChatService does that)
 *   - RAG chunking / embedding (Phase 3, separate pipeline)
 */
@Injectable()
export class AgentKnowledgeService {
  private readonly logger = new Logger(AgentKnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenCounter: TokenCounterService,
    private readonly agentCache: AgentCacheService,
  ) {}

  /**
   * Fetch the knowledge record for an agent, or null if none. Tenant-scoped:
   * the agent must belong to the caller's organization (CLIENT role).
   */
  async get(
    agentId: string,
    user: CurrentUserData,
  ): Promise<AgentKnowledge | null> {
    await assertAgentAccessible(this.prisma, agentId, user);
    return this.prisma.agentKnowledge.findUnique({ where: { agentId } });
  }

  /**
   * Create or replace the knowledge content for an agent. Used when the
   * operator pastes text directly (no file upload).
   *
   * Upserts: one knowledge record per agent (one-to-one). Calling this
   * repeatedly just overwrites the content.
   */
  async set(
    agentId: string,
    dto: UpdateKnowledgeDto,
    user: CurrentUserData,
  ): Promise<AgentKnowledge> {
    await assertAgentAccessible(this.prisma, agentId, user);
    const contentBytes = Buffer.byteLength(dto.content, 'utf-8');
    if (contentBytes > MAX_KNOWLEDGE_TEXT_BYTES) {
      throw new PayloadTooLargeException(
        `Knowledge content is ${contentBytes} bytes, exceeds the ${MAX_KNOWLEDGE_TEXT_BYTES} byte limit. Consider RAG for large knowledge bases.`,
      );
    }
    const contentTokens = this.tokenCounter.countTokens(dto.content);

    const updated = await this.prisma.agentKnowledge.upsert({
      where: { agentId },
      create: {
        agentId,
        content: dto.content,
        contentTokens,
        sourceFileName: dto.sourceFileName ?? null,
        sourceMimeType: dto.sourceMimeType ?? null,
      },
      update: {
        content: dto.content,
        contentTokens,
        sourceFileName: dto.sourceFileName ?? null,
        sourceMimeType: dto.sourceMimeType ?? null,
        // Clear sourceSizeBytes on text-paste updates (we don't know it).
        sourceSizeBytes: null,
      },
    });
    // Bust the agent cache so the next chat turn sees fresh knowledge.
    await this.agentCache.invalidate(agentId);
    return updated;
  }

  /**
   * Extract text from an uploaded file WITHOUT persisting. Returns the text
   * + metadata so the client can show it in an editable preview before
   * saving. This is the "preview" step; actual persistence happens via `set()`.
   *
   * UX flow (dashboard):
   *   1. User drops file → POST /knowledge/extract → text in a textarea
   *   2. User edits / cleans up formatting artefacts if needed
   *   3. User hits Save → PUT /knowledge with the (possibly-edited) text
   *
   * Rejects:
   *   - Files over MAX_KNOWLEDGE_UPLOAD_BYTES (10 MB)
   *   - Unsupported file types (PDF, DOCX, TXT, MD only)
   *   - Extractions that produce empty text
   *   - Extracted text over MAX_KNOWLEDGE_TEXT_BYTES
   *
   * Does NOT:
   *   - Touch the database (no writes)
   *   - Invalidate the cache (nothing changed yet)
   *   - Require the agent to exist (generalises: admins can preview before
   *     picking which agent to attach the text to — though current routing
   *     ties it to an agentId for permission checking)
   */
  async extractFile(
    agentId: string,
    file: Express.Multer.File,
    user: CurrentUserData,
  ): Promise<ExtractedText> {
    await assertAgentAccessible(this.prisma, agentId, user);

    if (!file) {
      throw new BadRequestException('No file provided.');
    }
    if (file.size > MAX_KNOWLEDGE_UPLOAD_BYTES) {
      throw new PayloadTooLargeException(
        `File is ${file.size} bytes, exceeds the ${MAX_KNOWLEDGE_UPLOAD_BYTES} byte limit.`,
      );
    }

    // Belt + suspenders: check MIME OR file extension. Some browsers /
    // operating systems send generic/empty MIME types for valid files, so we
    // fall back to extension sniffing.
    const ext = getFileExtension(file.originalname);
    const mimeOk = isAllowedKnowledgeMimeType(file.mimetype);
    const extOk = (KNOWLEDGE_UPLOAD_EXTENSIONS as readonly string[]).includes(ext);
    if (!mimeOk && !extOk) {
      throw new UnsupportedMediaTypeException(
        this.buildUnsupportedMessage(file.mimetype, ext),
      );
    }

    const extracted = await extractDocumentText(file.buffer, file.mimetype, ext);
    const trimmed = extracted.trim();
    if (!trimmed) {
      throw new BadRequestException(
        'No readable text could be extracted from the file. Try a different format or paste the text directly.',
      );
    }
    const textBytes = Buffer.byteLength(trimmed, 'utf-8');
    if (textBytes > MAX_KNOWLEDGE_TEXT_BYTES) {
      throw new PayloadTooLargeException(
        `Extracted text is ${textBytes} bytes, exceeds the ${MAX_KNOWLEDGE_TEXT_BYTES} byte limit. Consider RAG for large documents.`,
      );
    }

    const contentTokens = this.tokenCounter.countTokens(trimmed);

    this.logger.log(
      `Knowledge extracted for agent ${agentId}: ${file.originalname} (${file.mimetype || ext}, ${file.size} bytes → ${textBytes} bytes text, ${contentTokens} tokens). NOT persisted — call PUT /knowledge to save.`,
    );

    return {
      content: trimmed,
      contentTokens,
      sourceFileName: file.originalname?.slice(0, 255) ?? null,
      sourceMimeType: file.mimetype ?? null,
      sourceSizeBytes: file.size,
    };
  }

  /**
   * Produce a friendly error for rejected uploads. The .doc (old binary Word)
   * case gets a specific hint because it's the most common foot-gun.
   */
  private buildUnsupportedMessage(mime: string, ext: string): string {
    if (mime === 'application/msword' || ext === '.doc') {
      return 'Old Word format (.doc) is not supported. Please save the file as .docx (Word 2007+) and re-upload, or paste the text directly.';
    }
    return `Unsupported file type (MIME: "${mime || 'unknown'}", extension: "${ext || 'unknown'}"). Supported formats: PDF, DOCX, TXT, Markdown.`;
  }

  /** Remove the knowledge record for an agent. Idempotent. Tenant-scoped. */
  async remove(agentId: string, user: CurrentUserData): Promise<void> {
    await assertAgentAccessible(this.prisma, agentId, user);
    await this.prisma.agentKnowledge
      .delete({ where: { agentId } })
      .catch(() => {
        // Already gone — nothing to do.
      });
    await this.agentCache.invalidate(agentId);
  }
}

// Text extraction lives in ../utils/document-text.util.ts — shared with the
// RAG document pipeline (extractDocumentText / resolveDocumentFormat).
