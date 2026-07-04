import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../services/prisma.service';

import { EmbeddingService } from './embedding.service';

/** Candidates each retrieval arm returns before fusion/thresholding. */
const CANDIDATE_POOL = 30;

/** RRF constant — the standard k=60 from the original paper. */
const RRF_K = 60;
/** Fusion weights: semantic recall dominates, keywords rescue literal terms. */
const RRF_VECTOR_WEIGHT = 0.6;
const RRF_TEXT_WEIGHT = 0.4;

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  sourceType: 'FILE' | 'URL';
  sourceUrl: string | null;
  content: string;
  tokenCount: number;
  /** Cosine similarity (vector strategy) or fused RRF score (hybrid). */
  score: number;
  metadata: Record<string, unknown>;
}

export interface RetrieveParams {
  agentId: string;
  organizationId: string;
  query: string;
  strategy: 'hybrid' | 'vector';
  topK: number;
  /** Cosine-similarity floor applied to the vector arm. */
  similarityThreshold: number;
  sessionId?: string;
}

/**
 * RagRetrievalService: finds the chunks most relevant to a user message.
 *
 * Two strategies (agent-configurable via aiConfig.ragRetrievalStrategy):
 *
 *   'vector' — pgvector cosine similarity over the HNSW index.
 *   'hybrid' — vector + Postgres full-text search fused with weighted
 *              Reciprocal Rank Fusion (RRF, k=60). Rescues short literal
 *              tokens (error codes, SKUs, names) that embeddings miss.
 *
 * EVERY query filters by BOTH agentId and organizationId on the denormalised
 * chunk columns — tenant isolation lives in the SQL itself, never in
 * post-filtering (see rag-pipeline-deep-research §10 "Access Control").
 */
@Injectable()
export class RagRetrievalService {
  private readonly logger = new Logger(RagRetrievalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  /**
   * Cheap indexed existence check — lets DirectChatService skip embedding the
   * query entirely for the (very common) agent with no knowledge base.
   */
  async hasReadyDocuments(
    agentId: string,
    organizationId: string,
  ): Promise<boolean> {
    const doc = await this.prisma.agentDocument.findFirst({
      where: { agentId, organizationId, status: 'READY' },
      select: { id: true },
    });
    return doc !== null;
  }

  async retrieve(params: RetrieveParams): Promise<RetrievedChunk[]> {
    const queryEmbedding = await this.embedding.embedQuery(params.query, {
      organizationId: params.organizationId,
      agentId: params.agentId,
      sessionId: params.sessionId,
    });
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;

    // HNSW + WHERE filters post-filter the candidate list: with the default
    // ef_search=40, a tenant whose chunks aren't in the GLOBAL top-40
    // neighbours can get starved/empty results on a shared multi-tenant
    // table. SET LOCAL (transaction-scoped, PgBouncer-safe) widens the
    // candidate pool. On pgvector >= 0.8, `SET LOCAL hnsw.iterative_scan =
    // 'relaxed_order'` is the stronger fix — adopt once the fleet is
    // confirmed on 0.8; revisit per-tenant partial indexes past ~1M chunks.
    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL hnsw.ef_search = 100`;
      return params.strategy === 'vector'
        ? this.vectorSearch(tx, params, vectorLiteral)
        : this.hybridSearch(tx, params, vectorLiteral);
    });

    return rows.map((row) => ({
      chunkId: row.id,
      documentId: row.documentId,
      documentName: row.documentName,
      sourceType: row.sourceType as 'FILE' | 'URL',
      sourceUrl: row.sourceUrl,
      content: row.content,
      tokenCount: row.tokenCount,
      score: Number(row.score),
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    }));
  }

  private async vectorSearch(
    tx: Prisma.TransactionClient,
    params: RetrieveParams,
    vectorLiteral: string,
  ): Promise<RawChunkRow[]> {
    return tx.$queryRaw<RawChunkRow[]>`
      SELECT
        c."id", c."documentId", c."content", c."tokenCount", c."metadata",
        d."name" AS "documentName", d."sourceType"::text AS "sourceType",
        d."sourceUrl",
        1 - (c."embedding" <=> ${vectorLiteral}::vector) AS "score"
      FROM "agent_document_chunks" c
      JOIN "agent_documents" d ON d."id" = c."documentId"
      WHERE c."agentId" = ${params.agentId}
        AND c."organizationId" = ${params.organizationId}
        AND d."status"::text = 'READY'
        AND c."embedding" IS NOT NULL
        AND 1 - (c."embedding" <=> ${vectorLiteral}::vector) >= ${params.similarityThreshold}
      ORDER BY c."embedding" <=> ${vectorLiteral}::vector
      LIMIT ${params.topK}
    `;
  }

  /**
   * Hybrid: both arms run inside ONE statement (Postgres parallelises the
   * CTEs), fused with weighted RRF. The similarity threshold applies to the
   * vector arm only — text matches are rank-based by construction.
   */
  private async hybridSearch(
    tx: Prisma.TransactionClient,
    params: RetrieveParams,
    vectorLiteral: string,
  ): Promise<RawChunkRow[]> {
    return tx.$queryRaw<RawChunkRow[]>`
      WITH semantic AS (
        SELECT c."id",
               ROW_NUMBER() OVER (
                 ORDER BY c."embedding" <=> ${vectorLiteral}::vector
               ) AS rank
        FROM "agent_document_chunks" c
        JOIN "agent_documents" d ON d."id" = c."documentId"
        WHERE c."agentId" = ${params.agentId}
          AND c."organizationId" = ${params.organizationId}
          AND d."status"::text = 'READY'
          AND c."embedding" IS NOT NULL
          AND 1 - (c."embedding" <=> ${vectorLiteral}::vector) >= ${params.similarityThreshold}
        ORDER BY c."embedding" <=> ${vectorLiteral}::vector
        LIMIT ${CANDIDATE_POOL}
      ),
      keyword AS (
        SELECT c."id",
               ROW_NUMBER() OVER (
                 ORDER BY ts_rank(c."searchVector", websearch_to_tsquery('english', ${params.query})) DESC
               ) AS rank
        FROM "agent_document_chunks" c
        JOIN "agent_documents" d ON d."id" = c."documentId"
        WHERE c."agentId" = ${params.agentId}
          AND c."organizationId" = ${params.organizationId}
          AND d."status"::text = 'READY'
          AND c."searchVector" @@ websearch_to_tsquery('english', ${params.query})
        ORDER BY ts_rank(c."searchVector", websearch_to_tsquery('english', ${params.query})) DESC
        LIMIT ${CANDIDATE_POOL}
      ),
      fused AS (
        SELECT id, SUM(score) AS score FROM (
          SELECT id, ${RRF_VECTOR_WEIGHT} * (1.0 / (${RRF_K} + rank)) AS score FROM semantic
          UNION ALL
          SELECT id, ${RRF_TEXT_WEIGHT} * (1.0 / (${RRF_K} + rank)) AS score FROM keyword
        ) parts
        GROUP BY id
      )
      SELECT
        c."id", c."documentId", c."content", c."tokenCount", c."metadata",
        d."name" AS "documentName", d."sourceType"::text AS "sourceType",
        d."sourceUrl",
        fused.score AS "score"
      FROM fused
      JOIN "agent_document_chunks" c ON c."id" = fused.id
      JOIN "agent_documents" d ON d."id" = c."documentId"
      ORDER BY fused.score DESC
      LIMIT ${params.topK}
    `;
  }
}

interface RawChunkRow {
  id: string;
  documentId: string;
  content: string;
  tokenCount: number;
  metadata: unknown;
  documentName: string;
  sourceType: string;
  sourceUrl: string | null;
  score: number | Prisma.Decimal;
}
