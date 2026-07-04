/**
 * Shared file → plain-text extraction. Used by both the static knowledge base
 * (AgentKnowledgeService) and the RAG document pipeline (DocumentIngestion).
 *
 * Dispatches by MIME type first, falling back to file extension when MIME is
 * ambiguous (some browsers send `application/octet-stream` or
 * `application/zip` for valid .docx files).
 *
 * Uses dynamic imports so unused parsers don't eagerly load at boot.
 *
 * On parse failure (corrupt PDF, password-protected DOCX, etc.) we throw a
 * BadRequest with a message the operator can act on — not a 500.
 */
import {
  BadRequestException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';

export type DocumentFormat = 'pdf' | 'docx' | 'text' | 'unknown';

/**
 * Resolve a canonical format token from MIME + extension. Prefers the MIME
 * type, falls back to extension when MIME is generic (octet-stream, zip).
 */
export function resolveDocumentFormat(
  mime: string | undefined,
  ext: string,
): DocumentFormat {
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

/**
 * Extract plain text from an uploaded file buffer.
 *
 * @param buffer  Raw file bytes.
 * @param mime    Reported MIME type (may be generic/empty).
 * @param fileExtension Lowercased extension with leading dot ('.pdf').
 */
export async function extractDocumentText(
  buffer: Buffer,
  mime: string | undefined,
  fileExtension: string,
): Promise<string> {
  const format = resolveDocumentFormat(mime, fileExtension);

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
