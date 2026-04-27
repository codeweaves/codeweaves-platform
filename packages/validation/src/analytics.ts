import { z } from 'zod';

// ============================================
// Analytics Query Schemas
// ============================================

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

/**
 * IANA timezone validation. We only check that the string is well-formed
 * and accepted by Intl.DateTimeFormat — strict IANA-name checking happens
 * server-side via `Intl.supportedValuesOf('timeZone')` in
 * `apps/api/src/utils/date-range.ts`. Default `UTC` keeps existing
 * single-tz callers working without changes.
 */
const timezone = z
  .string()
  .min(1)
  .default('UTC')
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat(undefined, { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Invalid timezone' },
  );

const baseAnalyticsFilters = {
  startDate: dateString,
  endDate: dateString,
  /** IANA timezone for interpreting the date range (e.g. `Asia/Kolkata`). */
  timezone,
  agentId: z.string().uuid().optional(),
  agentIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.string().uuid()).optional()),
  orgId: z.string().uuid().optional(),
  orgIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.string().uuid()).optional()),
  source: z.enum(['WIDGET', 'WHATSAPP', 'DEMO']).optional(),
  sources: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.enum(['WIDGET', 'WHATSAPP', 'DEMO'])).optional()),
};

export const analyticsQuerySchema = z
  .object(baseAnalyticsFilters)
  .refine((d) => d.startDate <= d.endDate, {
    message: 'startDate must be before or equal to endDate',
    path: ['startDate'],
  });

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const agentAnalyticsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    ...baseAnalyticsFilters,
    sortBy: z
      .enum(['conversations', 'messages', 'avgResponseTimeMs', 'queriesRaised', 'agentName'])
      .default('conversations'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine((d) => d.startDate <= d.endDate, {
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
