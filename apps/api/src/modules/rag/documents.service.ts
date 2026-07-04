import { Buffer } from 'node:buffer';

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { AgentDocument } from '@prisma/client';
import {
  KNOWLEDGE_UPLOAD_EXTENSIONS,
  MAX_DOCUMENTS_PER_AGENT,
  MAX_DOCUMENT_TEXT_BYTES,
  MAX_DOCUMENT_UPLOAD_BYTES,
  getFileExtension,
  isAllowedKnowledgeMimeType,
  type IngestUrlDto,
} from '@repo/validation';

import { RagLoggerService } from '../../common/logger/rag.logger';
import type { CurrentUserData } from '../../decorators/current-user.decorator';
import { PrismaService } from '../../services/prisma.service';
import { assertAgentAccessible } from '../../utils/agent-access.util';
import { extractDocumentText } from '../../utils/document-text.util';
import { resolveAiConfig } from '../ai/resolve-ai-config';

import { ChunkingService } from './chunking.service';
import { DocumentIngestionService } from './document-ingestion.service';
import { UrlFetcherService } from './url-fetcher.service';

/** rawText is internal (large + only needed for re-indexing) — never expose. */
const DOCUMENT_LIST_SELECT = {
  id: true,
  agentId: true,
  name: true,
  sourceType: true,
  sourceUrl: true,
  mimeType: true,
  sizeBytes: true,
  status: true,
  errorMessage: true,
  chunkingStrategy: true,
  chunkCount: true,
  totalTokens: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type AgentDocumentListItem = Pick<
  AgentDocument,
  keyof typeof DOCUMENT_LIST_SELECT
>;

/**
 * DocumentsService: CRUD for the agent RAG knowledge base.
 *
 * Every method resolves the agent through assertAgentAccessible FIRST —
 * tenant isolation is non-negotiable here (this API replaces the code path
 * where the cross-tenant IDOR was found). organizationId is then denormalised
 * onto every row so retrieval SQL never needs a join to enforce it.
 *
 * Text extraction runs synchronously in the request (fast, and the user gets
 * immediate feedback on bad files/URLs); chunking + embedding run in the
 * background via DocumentIngestionService (status: PENDING → PROCESSING →
 * READY/FAILED, polled by the dashboard).
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: DocumentIngestionService,
    private readonly urlFetcher: UrlFetcherService,
    private readonly chunking: ChunkingService,
    private readonly ragLogger: RagLoggerService,
  ) {}

  async list(
    agentId: string,
    user: CurrentUserData,
  ): Promise<AgentDocumentListItem[]> {
    await assertAgentAccessible(this.prisma, agentId, user);
    return this.prisma.agentDocument.findMany({
      where: { agentId },
      select: DOCUMENT_LIST_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Upload a file → extract text now → index in the background. */
  async uploadFile(
    agentId: string,
    file: Express.Multer.File,
    user: CurrentUserData,
  ): Promise<AgentDocumentListItem> {
    const agent = await assertAgentAccessible(this.prisma, agentId, user);
    if (!file) throw new BadRequestException('No file provided.');
    if (file.size > MAX_DOCUMENT_UPLOAD_BYTES) {
      throw new PayloadTooLargeException(
        `File is ${file.size} bytes, exceeds the ${MAX_DOCUMENT_UPLOAD_BYTES} byte limit.`,
      );
    }

    const ext = getFileExtension(file.originalname);
    const mimeOk = isAllowedKnowledgeMimeType(file.mimetype);
    const extOk = (KNOWLEDGE_UPLOAD_EXTENSIONS as readonly string[]).includes(ext);
    if (!mimeOk && !extOk) {
      throw new UnsupportedMediaTypeException(
        `Unsupported file type (MIME: "${file.mimetype || 'unknown'}", extension: "${ext || 'unknown'}"). Supported formats: PDF, DOCX, TXT, Markdown.`,
      );
    }

    await this.assertUnderDocumentCap(agentId);

    const text = (
      await extractDocumentText(file.buffer, file.mimetype, ext)
    ).trim();
    this.assertUsableText(text);

    const document = await this.createAndEnqueue({
      agentId,
      organizationId: agent.organizationId,
      name: file.originalname?.slice(0, 255) || 'document',
      sourceType: 'FILE',
      sourceUrl: null,
      mimeType: file.mimetype?.slice(0, 127) ?? null,
      sizeBytes: file.size,
      rawText: text,
      uploadedById: user.id,
    });
    return document;
  }

  /** Ingest a public web page → fetch + extract now → index in background. */
  async ingestUrl(
    agentId: string,
    dto: IngestUrlDto,
    user: CurrentUserData,
  ): Promise<AgentDocumentListItem> {
    const agent = await assertAgentAccessible(this.prisma, agentId, user);
    await this.assertUnderDocumentCap(agentId);

    const page = await this.urlFetcher.fetchPage(dto.url);
    const text = page.text.trim();
    this.assertUsableText(text);

    const fallbackName = (() => {
      try {
        const u = new URL(dto.url);
        return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 255);
      } catch {
        return dto.url.slice(0, 255);
      }
    })();

    return this.createAndEnqueue({
      agentId,
      organizationId: agent.organizationId,
      name: dto.name?.slice(0, 255) || page.title || fallbackName,
      sourceType: 'URL',
      sourceUrl: dto.url,
      mimeType: page.contentType?.slice(0, 127) ?? null,
      sizeBytes: null,
      rawText: text,
      uploadedById: user.id,
    });
  }

  /**
   * Re-index with the agent's CURRENT chunking strategy (this is how a
   * strategy change propagates to existing documents). Uses the stored
   * rawText for uploads; URL documents are re-fetched for freshness.
   */
  async reindex(
    agentId: string,
    documentId: string,
    user: CurrentUserData,
  ): Promise<AgentDocumentListItem> {
    await assertAgentAccessible(this.prisma, agentId, user);
    const doc = await this.prisma.agentDocument.findFirst({
      where: { id: documentId, agentId },
    });
    if (!doc) throw new NotFoundException('Document not found.');
    if (doc.status === 'PROCESSING') {
      throw new BadRequestException('Document is already being processed.');
    }

    let rawText = doc.rawText;
    if (doc.sourceType === 'URL' && doc.sourceUrl) {
      const page = await this.urlFetcher.fetchPage(doc.sourceUrl);
      rawText = page.text.trim();
      this.assertUsableText(rawText);
    }
    if (!rawText?.trim()) {
      throw new BadRequestException(
        'No stored text for this document — delete and re-upload it.',
      );
    }

    const strategy = this.agentChunkingStrategy(agentId);
    const updated = await this.prisma.agentDocument.update({
      where: { id: documentId },
      data: {
        status: 'PENDING',
        errorMessage: null,
        rawText,
        contentHash: this.chunking.contentHash(rawText),
        chunkingStrategy: await strategy,
      },
      select: DOCUMENT_LIST_SELECT,
    });
    this.ingestion.enqueue(documentId);
    void this.ragLogger.logDocumentReindexed(agentId, {
      documentId,
      name: doc.name,
      chunkingStrategy: updated.chunkingStrategy,
    });
    return updated;
  }

  /** Hard delete — chunks cascade, vectors gone with them. */
  async remove(
    agentId: string,
    documentId: string,
    user: CurrentUserData,
  ): Promise<void> {
    await assertAgentAccessible(this.prisma, agentId, user);
    const doc = await this.prisma.agentDocument.findFirst({
      where: { id: documentId, agentId },
      select: { id: true, name: true },
    });
    if (!doc) throw new NotFoundException('Document not found.');
    await this.prisma.agentDocument.delete({ where: { id: documentId } });
    void this.ragLogger.logDocumentDeleted(agentId, {
      documentId,
      name: doc.name,
    });
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private async createAndEnqueue(input: {
    agentId: string;
    organizationId: string;
    name: string;
    sourceType: 'FILE' | 'URL';
    sourceUrl: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    rawText: string;
    uploadedById: string;
  }): Promise<AgentDocumentListItem> {
    const chunkingStrategy = await this.agentChunkingStrategy(input.agentId);
    const document = await this.prisma.agentDocument.create({
      data: {
        agentId: input.agentId,
        organizationId: input.organizationId,
        name: input.name,
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        status: 'PENDING',
        chunkingStrategy,
        contentHash: this.chunking.contentHash(input.rawText),
        rawText: input.rawText,
        uploadedById: input.uploadedById,
      },
      select: DOCUMENT_LIST_SELECT,
    });

    this.ingestion.enqueue(document.id);
    void this.ragLogger.logDocumentCreated(input.agentId, {
      documentId: document.id,
      name: document.name,
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl,
      sizeBytes: input.sizeBytes,
      chunkingStrategy,
    });

    this.logger.log(
      `[createAndEnqueue] - document ${document.id} (${input.sourceType}) queued for agent ${input.agentId}`,
    );
    return document;
  }

  /** The agent's configured default chunking strategy (aiConfig). */
  private async agentChunkingStrategy(agentId: string): Promise<string> {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { aiConfig: true },
    });
    return resolveAiConfig(agent?.aiConfig).ragChunkingStrategy;
  }

  private async assertUnderDocumentCap(agentId: string): Promise<void> {
    const count = await this.prisma.agentDocument.count({
      where: { agentId },
    });
    if (count >= MAX_DOCUMENTS_PER_AGENT) {
      throw new BadRequestException(
        `Document limit reached (${MAX_DOCUMENTS_PER_AGENT} per agent). Delete unused documents first.`,
      );
    }
  }

  private assertUsableText(text: string): void {
    if (!text) {
      throw new BadRequestException(
        'No readable text could be extracted. Try a different format or page.',
      );
    }
    const bytes = Buffer.byteLength(text, 'utf-8');
    if (bytes > MAX_DOCUMENT_TEXT_BYTES) {
      throw new PayloadTooLargeException(
        `Extracted text is ${bytes} bytes, exceeds the ${MAX_DOCUMENT_TEXT_BYTES} byte per-document limit. Split the source into smaller documents.`,
      );
    }
  }
}
