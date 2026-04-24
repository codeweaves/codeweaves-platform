/**
 * Chat validation schemas
 * Zod schemas for chat message input validation
 */
import { z } from 'zod';

// ============================================
// Send Message Schema
// ============================================

/**
 * Optional client-supplied chat history. When present, the orchestrator skips
 * its DB history lookup and uses this instead — saves a Supabase round-trip
 * (~150-450ms) on the hot path. Same pattern ChatGPT / Claude web clients use.
 *
 * Do NOT include the message being sent now — that's `chatInput`.
 * Order: oldest → newest.
 *
 * Cap is enforced server-side by `aiConfig.maxContextMessages`; clients can
 * send generously (e.g. up to 50) and the backend trims before the LLM call.
 * Capped at 100 here only as a sanity bound to keep request bodies reasonable.
 */
export const chatHistoryItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(10_000),
});

export const sendMessageSchema = z.object({
  chatInput: z.string().min(1, 'Message cannot be empty').max(4000, 'Message must be at most 4000 characters'),
  agentId: z.string().min(1, 'Agent ID is required').max(128, 'Agent ID must be at most 128 characters'),
  sessionId: z.string().max(128, 'Session ID must be at most 128 characters').optional(),
  source: z.enum(['DEMO', 'WIDGET', 'WHATSAPP']).optional(),
  recentHistory: z.array(chatHistoryItemSchema).max(100).optional(),
});

export type SendMessageDto = z.infer<typeof sendMessageSchema>;
export type ChatHistoryItem = z.infer<typeof chatHistoryItemSchema>;
