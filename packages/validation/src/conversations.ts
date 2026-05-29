/**
 * Conversations validation schemas
 *
 * Powers the dashboard "Conversations" view: a paginated list of chat sessions
 * across agents/orgs (scoped by role) plus a per-session detail endpoint that
 * returns the full transcript and optional execution traces.
 */
import { z } from 'zod';

// ============================================
// Shared filters
// ============================================

const sourceEnum = z.enum(['WIDGET', 'WHATSAPP', 'DEMO']);
const statusEnum = z.enum(['ACTIVE', 'EXPIRED']);

// ISO datetime (full timestamp) — used for from/to bounds on createdAt.
// Range is half-open: createdAt >= from AND createdAt <= to.
const isoDateTime = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid ISO datetime');

export const conversationsListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    search: z.string().trim().max(200).optional(),
    agentId: z.string().uuid().optional(),
    agentIds: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
      .pipe(z.array(z.string().uuid()).optional()),
    orgId: z.string().uuid().optional(),
    source: sourceEnum.optional(),
    sources: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
      .pipe(z.array(sourceEnum).optional()),
    status: statusEnum.optional(),
    statuses: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
      .pipe(z.array(statusEnum).optional()),
    // Match against ChatSession.category set by the background classifier.
    // Categories are free-text per agent (no enum) so we accept any string;
    // empty strings are filtered out so a stray `?categories=,` doesn't break.
    categories: z
      .string()
      .optional()
      .transform((v) =>
        v
          ? v.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined,
      )
      .pipe(z.array(z.string().min(1).max(100)).optional()),
    visitorId: z.string().trim().max(200).optional(),
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
    sortBy: z
      .enum(['lastMessageAt', 'createdAt', 'messageCount'])
      .default('lastMessageAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine(
    (d) => !(d.from && d.to) || new Date(d.from) <= new Date(d.to),
    { message: 'from must be before or equal to to', path: ['from'] },
  );

export type ConversationsListQuery = z.infer<typeof conversationsListQuerySchema>;

export const conversationDetailParamsSchema = z.object({
  sessionId: z.string().min(1).max(128),
});

export type ConversationDetailParams = z.infer<typeof conversationDetailParamsSchema>;
