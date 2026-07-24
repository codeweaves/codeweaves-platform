import { Buffer } from 'node:buffer';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
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
import { AppLogger } from '../common/logger/app-logger';
import { TracerService } from '../common/tracer/tracer.service';
import { TokenCounterService } from '../modules/ai/token-counter.service';

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
  private readonly log = new AppLogger(AgentKnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenCounter: TokenCounterService,
    private readonly agentCache: AgentCacheService,
    private readonly tracer: TracerService,
  ) {}

  /** Fetch the knowledge record for an agent, or null if none. */
  async get(agentId: string): Promise<AgentKnowledge | null> {
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
  ): Promise<AgentKnowledge> {
    await this.assertAgentExists(agentId);
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
    this.log.info('set', 'knowledge content saved', { agentId, contentBytes, contentTokens });
    // Accountability: changes text prepended to the system prompt (what the bot
    // tells customers). Size/source only — not the content body.
    await this.tracer.logAuditEvent(
      agentId,
      'AGENT_KNOWLEDGE_UPDATED',
      { response: { contentBytes, contentTokens, sourceFileName: dto.sourceFileName ?? null } },
      { agentId },
    );
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
  ): Promise<ExtractedText> {
    await this.assertAgentExists(agentId);
    this.log.debug('extractFile', 'extracting knowledge from upload', {
      agentId,
      mimeType: file?.mimetype,
      bytes: file?.size,
    });

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

    const extracted = await extractText(file, ext);
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

    this.log.info(
      'extractFile',
      'knowledge extracted (not persisted — PUT /knowledge to save)',
      {
        agentId,
        mimeType: file.mimetype || ext,
        uploadBytes: file.size,
        textBytes,
        contentTokens,
      },
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

  /** Remove the knowledge record for an agent. Idempotent. */
  async remove(agentId: string): Promise<void> {
    await this.prisma.agentKnowledge
      .delete({ where: { agentId } })
      .catch(() => {
        // Already gone — nothing to do.
      });
    await this.agentCache.invalidate(agentId);
    this.log.info('remove', 'knowledge removed', { agentId });
    await this.tracer.logAuditEvent(
      agentId,
      'AGENT_KNOWLEDGE_DELETED',
      { response: {} },
      { agentId },
    );
  }

  private async assertAgentExists(agentId: string): Promise<void> {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, deletedAt: null },
      select: { id: true },
    });
    if (!agent) {
      throw new NotFoundException(`Agent ${agentId} not found or inactive.`);
    }
  }
}

// ============================================================================
// Text extraction — dispatch by MIME type
// ============================================================================

/**
 * Extract plain text from an uploaded file. Dispatches by MIME first, falling
 * back to file extension when MIME is ambiguous (some browsers send
 * `application/octet-stream` or `application/zip` for valid .docx files).
 *
 * Uses dynamic imports so unused parsers don't eagerly load at boot.
 *
 * On parse failure (corrupt PDF, password-protected DOCX, etc.) we throw a
 * BadRequest with a message the operator can act on — not a 500.
 */
async function extractText(
  file: Express.Multer.File,
  fileExtension: string,
): Promise<string> {
  const mime = file.mimetype;
  const buffer = file.buffer;

  // Reconcile MIME + extension → canonical format. Extension wins when MIME
  // is the generic octet-stream / zip fallback because those are ambiguous.
  const format = resolveFormat(mime, fileExtension);

  try {
    if (format === 'text') {
      // Plain text / markdown — UTF-8 decode is all we need.
      return buffer.toString('utf-8');
    }

    if (format === 'pdf') {
      // pdf-parse v2 uses a class-based API (vs v1's function call).
      // Convert Buffer → Uint8Array because the worker transfers TypedArrays
      // for lower memory usage than plain Buffers.
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({
        data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
      });
      try {
        const result = await parser.getText();
        return result.text;
      } finally {
        // Release the PDF worker + document. Skipping this leaks workers for
        // long-running processes.
        await parser.destroy().catch(() => undefined);
      }
    }

    if (format === 'docx') {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }

    // Shouldn't reach here — caller gated by MIME + extension.
    throw new UnsupportedMediaTypeException(
      `Unhandled file format (MIME: "${mime}", extension: "${fileExtension}").`,
    );
  } catch (err) {
    if (err instanceof UnsupportedMediaTypeException) throw err;
    const message = err instanceof Error ? err.message : 'unknown error';
    throw new BadRequestException(
      `Failed to extract text from file (${mime || fileExtension || 'unknown format'}): ${message}. The file may be corrupt, password-protected, or use an unsupported variant.`,
    );
  }
}

/**
 * Resolve a canonical format token from MIME + extension. Prefers the MIME
 * type, falls back to extension when MIME is generic (octet-stream, zip).
 */
function resolveFormat(
  mime: string | undefined,
  ext: string,
): 'pdf' | 'docx' | 'text' | 'unknown' {
  // Precise MIME matches first.
  if (mime === 'application/pdf') return 'pdf';
  if (
    mime ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  if (
    mime === 'text/plain' ||
    mime === 'text/markdown' ||
    mime === 'text/x-markdown'
  ) {
    return 'text';
  }
  // Fall back to extension for ambiguous MIMEs (browsers on Windows often
  // report .docx as application/octet-stream or application/zip).
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  if (ext === '.txt' || ext === '.md' || ext === '.markdown') return 'text';
  return 'unknown';
}
