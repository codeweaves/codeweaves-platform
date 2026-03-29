/**
 * Chat validation schemas
 * Zod schemas for chat message input validation
 */
import { z } from 'zod';

// ============================================
// Send Message Schema
// ============================================

export const sendMessageSchema = z.object({
  chatInput: z.string().min(1, 'Message cannot be empty').max(4000, 'Message must be at most 4000 characters'),
  agentId: z.string().min(1, 'Agent ID is required').max(128, 'Agent ID must be at most 128 characters'),
  sessionId: z.string().max(128, 'Session ID must be at most 128 characters').optional(),
});

export type SendMessageDto = z.infer<typeof sendMessageSchema>;
