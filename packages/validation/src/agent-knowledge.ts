/**
 * Validation schemas for the agent knowledge base ("static KB": text stuffed
 * into the system prompt on every chat, no RAG). See `AgentKnowledge` in the
 * Prisma schema for the persisted shape.
 */
import { z } from 'zod';

// ============================================
// Limits
// ============================================

/**
 * Max file size we accept for KB uploads. 10 MB is enough for ~300-page PDFs
 * even before text extraction (which strips formatting). Larger docs should
 * use RAG (Phase 3).
 */
export const MAX_KNOWLEDGE_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Max extracted TEXT size we persist. 500 KB ≈ 125K tokens for typical
 * English prose. Above this, the text will barely fit in any model's context
 * window anyway, so we reject + nudge users toward RAG.
 */
export const MAX_KNOWLEDGE_TEXT_BYTES = 500 * 1024;

/**
 * Warning threshold — text that fits but will push per-message cost up.
 * UI can show a banner: "This knowledge base will add X tokens to every
 * message. Consider RAG for lower cost-per-chat."
 */
export const KNOWLEDGE_SIZE_WARNING_TOKENS = 50_000;

// ============================================
// Supported MIME types for upload extraction
// ============================================

/**
 * MIME types we accept for knowledge-base text extraction. Browsers sometimes
 * report a generic type (application/octet-stream, application/zip for .docx)
 * depending on OS — we fall back to file-extension sniffing for those cases
 * in the extractor (see agent-knowledge.service.ts).
 *
 * Explicitly UNSUPPORTED:
 *   - application/msword (.doc, old binary Word format) — needs different
 *     library (word-extractor). Ask users to save as .docx.
 *   - application/rtf — minimal demand, requires RTF parser.
 *   - text/html — would need sanitiser; paste text directly instead.
 */
export const KNOWLEDGE_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  // Browsers sometimes send these for .docx/.txt/.md depending on the OS
  // MIME registry state; the extractor falls back to filename extension.
  'application/octet-stream',
  'application/zip', // .docx is technically a zip
] as const;

export type KnowledgeUploadMimeType = (typeof KNOWLEDGE_UPLOAD_MIME_TYPES)[number];

export function isAllowedKnowledgeMimeType(
  mime: string | undefined | null,
): mime is KnowledgeUploadMimeType {
  return (
    typeof mime === 'string' &&
    (KNOWLEDGE_UPLOAD_MIME_TYPES as readonly string[]).includes(mime)
  );
}

/** File extensions we can extract text from (lowercased, with leading dot). */
export const KNOWLEDGE_UPLOAD_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.txt',
  '.md',
  '.markdown',
] as const;

/** Extract lowercased extension from a filename, or empty string. */
export function getFileExtension(filename: string | undefined): string {
  if (!filename) return '';
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx).toLowerCase() : '';
}

// ============================================
// Text update (paste / edit raw text)
// ============================================

/**
 * Schema for PUT /agents/:id/knowledge — set or replace the knowledge content
 * as plain text. Rejects empty strings (to clear knowledge, use DELETE).
 */
export const updateKnowledgeSchema = z.object({
  /** The knowledge text. Stored verbatim; appended to system prompt at chat time. */
  content: z
    .string()
    .min(1, 'Knowledge content cannot be empty. Use DELETE to clear.')
    .max(
      MAX_KNOWLEDGE_TEXT_BYTES,
      `Knowledge content exceeds ${MAX_KNOWLEDGE_TEXT_BYTES} bytes. Consider splitting across multiple documents or using RAG (Phase 3).`,
    ),
  /**
   * Optional — if the text came from a file the operator uploaded elsewhere.
   * Accepts `null` (explicitly cleared, e.g. after pasting text with no source
   * file) in addition to `undefined` (field omitted entirely) so the frontend
   * can round-trip `formData.knowledgeSourceFileName` without stripping nulls.
   */
  sourceFileName: z.string().max(255).nullable().optional(),
  /** Optional — MIME type of the source file, if applicable. `null` allowed. */
  sourceMimeType: z.string().max(127).nullable().optional(),
});

export type UpdateKnowledgeDto = z.infer<typeof updateKnowledgeSchema>;

// ============================================
// Response / DTO shapes (for OpenAPI + client types)
// ============================================

export const knowledgeResponseSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  content: z.string(),
  contentTokens: z.number().int().nullable(),
  sourceFileName: z.string().nullable(),
  sourceMimeType: z.string().nullable(),
  sourceSizeBytes: z.number().int().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type KnowledgeResponse = z.infer<typeof knowledgeResponseSchema>;
