import { Injectable } from '@nestjs/common';

import { TracerService } from '../tracer/tracer.service';

/**
 * Domain logger for the RAG knowledge-base pipeline. Same pattern as
 * AgentLoggerService: every event lands in `audit_logs` via TracerService,
 * fire-and-forget (a failed audit write must never break ingestion or chat).
 * contextId = agentId so an agent's whole knowledge history is one query.
 */
@Injectable()
export class RagLoggerService {
  constructor(private readonly tracer: TracerService) {}

  async logDocumentCreated(agentId: string, data: Record<string, unknown>) {
    await this.tracer.logAuditEvent(
      agentId,
      'RAG_DOCUMENT_CREATED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logDocumentIngested(agentId: string, data: Record<string, unknown>) {
    await this.tracer.logAuditEvent(
      agentId,
      'RAG_DOCUMENT_INGESTED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logDocumentIngestionFailed(
    agentId: string,
    error: unknown,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      agentId,
      'RAG_DOCUMENT_INGESTION_FAILED',
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
    );
  }

  async logDocumentReindexed(agentId: string, data: Record<string, unknown>) {
    await this.tracer.logAuditEvent(
      agentId,
      'RAG_DOCUMENT_REINDEXED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  async logDocumentDeleted(agentId: string, data: Record<string, unknown>) {
    await this.tracer.logAuditEvent(
      agentId,
      'RAG_DOCUMENT_DELETED',
      this.tracer.mergeJsonResponse({ response: data }),
    );
  }

  /**
   * Retrieval failures on the chat hot path. Retrieval errors degrade
   * gracefully (chat proceeds without RAG) — this event is how we notice.
   */
  async logRetrievalFailed(
    agentId: string,
    error: unknown,
    data: Record<string, unknown>,
  ) {
    await this.tracer.logAuditEvent(
      agentId,
      'RAG_RETRIEVAL_FAILED',
      this.tracer.mergeJsonResponse(
        { error: { message: String(error) } },
        data,
      ),
    );
  }
}
