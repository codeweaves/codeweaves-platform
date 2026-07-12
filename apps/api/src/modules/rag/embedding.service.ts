import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { embed, embedMany } from 'ai';

import { AiSdkService } from '../ai/ai-sdk.service';
import { UsageTrackingService } from '../ai/usage-tracking.service';

/**
 * Default embedding model. text-embedding-3-small: 1536 dims, $0.02/1M tokens,
 * solid multilingual quality — the recommended starting point per
 * rag-pipeline-deep-research §5.
 *
 * IMPORTANT: the pgvector column is vector(1536). Switching to a model with a
 * different dimensionality requires a migration AND re-embedding every chunk —
 * never change EMBEDDING_MODEL casually in prod.
 */
const DEFAULT_EMBEDDING_MODEL = 'openai:text-embedding-3-small';

/** OpenAI accepts up to 2048 inputs per call; 96 keeps request bodies modest. */
const EMBED_BATCH_SIZE = 96;

export const EMBEDDING_DIMENSIONS = 1536;

/**
 * EmbeddingService: turns text into vectors for indexing (documents) and
 * querying (chat retrieval). Thin wrapper over AI SDK `embed`/`embedMany` via
 * the shared AiSdkService provider registry; usage is recorded to LlmUsage
 * (feature: 'embedding' for ingestion, 'rag-query' for query embeds).
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(
    private readonly aiSdk: AiSdkService,
    private readonly config: ConfigService,
    private readonly usageTracker: UsageTrackingService,
  ) {}

  getModelId(): string {
    return (
      this.config.get<string>('EMBEDDING_MODEL') ?? DEFAULT_EMBEDDING_MODEL
    );
  }

  /**
   * Batch-embed document chunks. Returns vectors in input order.
   * Batches of EMBED_BATCH_SIZE, sequential (ingestion is a background path —
   * politeness to rate limits beats parallel speed here).
   */
  async embedTexts(
    texts: string[],
    tracking: { organizationId: string; agentId: string },
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    const modelId = this.getModelId();
    const model = this.aiSdk.getEmbeddingModel(modelId);
    const startedAt = performance.now();

    const vectors: number[][] = [];
    let totalTokens = 0;
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
      const result = await embedMany({ model, values: batch });
      vectors.push(...result.embeddings);
      totalTokens += result.usage?.tokens ?? 0;
    }

    this.trackUsage(tracking, modelId, totalTokens, startedAt, 'embedding');
    return vectors;
  }

  /** Embed a single retrieval query (hot path — one API call). */
  async embedQuery(
    text: string,
    tracking: { organizationId: string; agentId: string; sessionId?: string },
  ): Promise<number[]> {
    const modelId = this.getModelId();
    const model = this.aiSdk.getEmbeddingModel(modelId);
    const startedAt = performance.now();

    const result = await embed({ model, value: text });

    this.trackUsage(
      tracking,
      modelId,
      result.usage?.tokens ?? 0,
      startedAt,
      'rag-query',
    );
    return result.embedding;
  }

  private trackUsage(
    tracking: { organizationId: string; agentId: string; sessionId?: string },
    modelId: string,
    tokens: number,
    startedAt: number,
    feature: 'embedding' | 'rag-query',
  ): void {
    this.usageTracker.record({
      organizationId: tracking.organizationId,
      agentId: tracking.agentId,
      sessionId: tracking.sessionId,
      model: modelId,
      requestedModel: modelId,
      usage: { inputTokens: tokens, outputTokens: 0, totalTokens: tokens },
      cost: null, // embedding providers don't return cost in-band
      feature,
      latencyMs: Math.round(performance.now() - startedAt),
    });
  }
}
