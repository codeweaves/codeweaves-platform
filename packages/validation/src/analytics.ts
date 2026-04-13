import { z } from 'zod';

// ============================================
// Analytics Query Schemas
// ============================================

export const analyticsQuerySchema = z.object({
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  agentId: z.string().uuid().optional(),
  orgId: z.string().uuid().optional(),
  source: z.enum(['WIDGET', 'WHATSAPP']).optional(),
}).refine((data) => data.startDate <= data.endDate, {
  message: 'startDate must be before or equal to endDate',
  path: ['startDate'],
});

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const agentAnalyticsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  agentId: z.string().uuid().optional(),
  orgId: z.string().uuid().optional(),
  source: z.enum(['WIDGET', 'WHATSAPP']).optional(),
  sortBy: z.enum(['conversations', 'messages', 'avgResponseTimeMs', 'queriesRaised', 'agentName']).default('conversations'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
}).refine((data) => data.startDate <= data.endDate, {
  message: 'startDate must be before or equal to endDate',
  path: ['startDate'],
});

export type AgentAnalyticsQuery = z.infer<typeof agentAnalyticsQuerySchema>;

export const exportLogBodySchema = z.object({
  format: z.enum(['csv', 'json']),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});

export type ExportLogBody = z.infer<typeof exportLogBodySchema>;
