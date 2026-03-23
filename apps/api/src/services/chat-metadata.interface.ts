/**
 * Base metadata fields present in ALL chat message metadata (both streaming modes).
 * Index signature allows assignment to Prisma's InputJsonValue without casts.
 */
export interface BaseChatMetadata {
  [key: string]: string | number | null;
  backendReceivedAt: string;
  n8nReceivedAt: string | null;
  agentRepliedAt: string | null;
  backendRespondedAt: string;
  responseLatencyMs: number;
}

/**
 * Metadata for simulated streaming (legacy webhook path).
 * n8n returns the full response in one shot; backend chunks it for SSE.
 */
export interface SimulatedStreamingMetadata extends BaseChatMetadata {
  streamingMode: 'simulated';
}

/**
 * Metadata for real streaming (n8n Chat Trigger path).
 * Includes additional fields extracted from the stream chunks.
 */
export interface RealStreamingMetadata extends BaseChatMetadata {
  streamingMode: 'real';
  /** Milliseconds from backend request to first item chunk arrival. */
  timeToFirstToken: number | null;
  /** Milliseconds from backend request to last item chunk arrival (end-to-end streaming completion). */
  timeToLastToken: number | null;
  /** Count of item chunks received from the stream. */
  totalChunks: number;
  /** Milliseconds between begin and end chunk timestamps (n8n processing time). */
  streamDurationMs: number | null;
}

/**
 * Metadata for non-streaming (direct webhook send path).
 * No streamingMode field — distinguishable by absence.
 */
export type DirectMetadata = BaseChatMetadata;

/**
 * Union of all chat message metadata shapes.
 * All shapes share BaseChatMetadata fields, so analytics queries on
 * responseLatencyMs, n8nReceivedAt, and agentRepliedAt work across all modes.
 */
export type ChatMessageMetadata = DirectMetadata | SimulatedStreamingMetadata | RealStreamingMetadata;
