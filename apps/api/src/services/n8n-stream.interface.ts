/**
 * Represents the type of chunk received from n8n Chat Trigger streaming response.
 * - `begin`: Stream start marker with metadata (timestamp = n8nReceivedAt)
 * - `item`: Individual token/content chunk
 * - `end`: Stream completion marker (timestamp = agentRepliedAt)
 */
export type N8nStreamChunkType = 'begin' | 'item' | 'end';

/** Valid chunk types for runtime validation. */
export const VALID_CHUNK_TYPES = new Set<string>(['begin', 'item', 'end']);

/**
 * Metadata attached to each n8n streaming chunk.
 */
export interface N8nStreamChunkMetadata {
  timestamp: number;
  nodeId?: string;
  nodeName?: string;
}

/**
 * Shape of each chunk yielded by the n8n Chat Trigger streaming response.
 *
 * n8n Chat Trigger returns newline-delimited JSON (NOT SSE).
 * Each line is one of: begin, item, or end.
 *
 * - `begin`/`end` chunks MUST have `metadata.timestamp` (validated at runtime).
 *   begin.metadata.timestamp → maps to n8nReceivedAt
 *   end.metadata.timestamp   → maps to agentRepliedAt
 * - `item` chunks carry `content` (the token text).
 *
 * Example:
 * ```
 * {"type":"begin","metadata":{"nodeId":"abc","timestamp":1774234478437}}
 * {"type":"item","content":"Hello","metadata":{"nodeId":"abc","timestamp":1774234478500}}
 * {"type":"end","metadata":{"nodeId":"abc","timestamp":1774234480792}}
 * ```
 */
export interface N8nStreamChunk {
  type: N8nStreamChunkType;
  content?: string;
  metadata?: N8nStreamChunkMetadata;
}
