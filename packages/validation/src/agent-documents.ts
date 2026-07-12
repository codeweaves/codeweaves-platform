/**
 * Validation schemas for the agent RAG knowledge base: per-agent document
 * collections that are chunked, embedded (pgvector) and retrieved at chat
 * time with citations. See `AgentDocument` / `AgentDocumentChunk` in the
 * Prisma schema for the persisted shape.
 *
 * Distinct from the legacy static KB (`agent-knowledge.ts`), which stuffs one
 * text blob into every prompt. Documents here are retrieved selectively.
 */
import { z } from 'zod';

// ============================================
// Limits
// ============================================

/** Max file size accepted for document uploads (same ceiling as static KB). */
export const MAX_DOCUMENT_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Max extracted TEXT per document. 2 MB ≈ 500K tokens of prose — far beyond
 * what any single support document needs; protects the DB row (rawText is
 * kept for re-indexing) and the embedding bill.
 */
export const MAX_DOCUMENT_TEXT_BYTES = 2 * 1024 * 1024;

/** Max documents per agent. Raise deliberately, not accidentally. */
export const MAX_DOCUMENTS_PER_AGENT = 25;

// ============================================
// Enums (mirrored from Prisma so the frontend gets types without @prisma/client)
// ============================================

export const documentStatusEnum = z.enum([
  'PENDING',
  'PROCESSING',
  'READY',
  'FAILED',
]);
export type DocumentStatus = z.infer<typeof documentStatusEnum>;

export const documentSourceTypeEnum = z.enum(['FILE', 'URL']);
export type DocumentSourceType = z.infer<typeof documentSourceTypeEnum>;

/** Chunking strategies supported at ingestion time. Keep in sync with
 * `agentAiConfigSchema.ragChunkingStrategy`. */
export const chunkingStrategyEnum = z.enum(['recursive', 'fixed', 'markdown']);
export type ChunkingStrategy = z.infer<typeof chunkingStrategyEnum>;

// ============================================
// Ingest a URL
// ============================================

/**
 * Schema for POST /agents/:agentId/documents/url — ingest a public web page.
 * Only http(s) URLs; the backend additionally enforces SSRF protections
 * (private/reserved IP rejection, no redirect following, size caps).
 */
export const ingestUrlSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'URL is required')
    .max(2048, 'URL is too long')
    .url('Must be a valid URL')
    .refine(
      (u) => u.startsWith('https://') || u.startsWith('http://'),
      'Only http(s) URLs are supported',
    ),
  /** Display name override. Defaults to the page title or the URL host+path. */
  name: z.string().trim().max(255).optional(),
});

export type IngestUrlDto = z.infer<typeof ingestUrlSchema>;

// ============================================
// Response shape (for OpenAPI + client types)
// ============================================

export const agentDocumentResponseSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  name: z.string(),
  sourceType: documentSourceTypeEnum,
  sourceUrl: z.string().nullable(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  status: documentStatusEnum,
  errorMessage: z.string().nullable(),
  chunkingStrategy: chunkingStrategyEnum,
  chunkCount: z.number().int(),
  totalTokens: z.number().int(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type AgentDocumentResponse = z.infer<typeof agentDocumentResponseSchema>;

// ============================================
// Citations (chat metadata shape shared by API, widget and dashboard)
// ============================================

/**
 * A resolved citation attached to an assistant message. Emitted in the SSE
 * `done` event metadata and persisted on ChatMessage.metadata so past
 * conversations keep their sources.
 *
 * Type alias (NOT interface) on purpose: aliases get an implicit index
 * signature, which keeps ChatMessageMetadata assignable to Prisma's
 * InputJsonValue when citations ride along.
 */
export type ChatCitation = {
  /** 1-based citation index as referenced in the response text, e.g. [1]. */
  index: number;
  documentId: string;
  documentName: string;
  sourceType: DocumentSourceType;
  /** Present for URL documents so the UI can link out. */
  sourceUrl?: string | null;
  /** Short excerpt of the cited chunk (for hover previews). */
  snippet: string;
};
