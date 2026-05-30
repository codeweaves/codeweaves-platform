/**
 * @repo/validation
 * Shared Zod schemas for validation across frontend and backend
 */
import { z } from 'zod';
import { agentAiConfigUpdateSchema } from './agent-ai-config.js';
import { voiceConfigSchema } from './voice.js';

// Re-export zod for convenience
export { z } from 'zod';

// Re-export theme schemas and types
export * from './theme.js';

// Re-export chat schemas and types
export * from './chat.js';

// Re-export analytics schemas and types
export * from './analytics.js';

// Re-export conversations schemas and types
export * from './conversations.js';

// Re-export voice schemas and types
export * from './voice.js';

// Re-export agent AI configuration schemas and types
export * from './agent-ai-config.js';

// Re-export agent knowledge schemas and types
export * from './agent-knowledge.js';

// ============================================
// Common Schemas
// ============================================

export const emailSchema = z.string().email('Invalid email address');

export const uuidSchema = z.string().uuid('Invalid UUID');

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type Pagination = z.infer<typeof paginationSchema>;

// ============================================
// Environment Schemas
// ============================================

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

// ============================================
// API Response Schemas
// ============================================

export const apiErrorSchema = z.object({
  statusCode: z.number(),
  message: z.string(),
  error: z.string().optional(),
  timestamp: z.string().datetime().optional(),
  path: z.string().optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const paginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    meta: z.object({
      page: z.number(),
      limit: z.number(),
      total: z.number(),
      totalPages: z.number(),
    }),
  });

// ============================================
// Role Enum (mirrors Prisma Role enum)
// ============================================

export const roleEnum = z.enum(['SUPER_ADMIN', 'ADMIN', 'CLIENT']);
export type RoleEnum = z.infer<typeof roleEnum>;

// ============================================
// User Profile Schemas
// ============================================

export const updateUserProfileSchema = z.object({
  name: z.string().min(1, 'Name must be at least 1 character').max(100, 'Name must be at most 100 characters').optional(),
});

export type UpdateUserProfileDto = z.infer<typeof updateUserProfileSchema>;

export const organizationSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
});

export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;

export const userProfileResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: roleEnum,
  organization: organizationSummarySchema.nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type UserProfileResponse = z.infer<typeof userProfileResponseSchema>;

// ============================================
// Organization Management Schemas
// ============================================

export const slugSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'Slug must start/end with a letter or number, and contain only lowercase letters, numbers, and hyphens',
  )
  .min(2, 'Slug must be at least 2 characters')
  .max(100, 'Slug must be at most 100 characters');

export const organizationListQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
  sortBy: z.enum(['name', 'slug', 'createdAt', 'usersCount', 'agentsCount']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type OrganizationListQuery = z.infer<typeof organizationListQuerySchema>;

export const createOrganizationSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters').max(100, 'Name must be at most 100 characters'),
  slug: slugSchema.optional(),
});

export type CreateOrganizationDto = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z
  .object({
    name: z.string().min(3, 'Name must be at least 3 characters').max(100, 'Name must be at most 100 characters').optional(),
    slug: slugSchema.optional(),
  })
  .refine((data) => data.name !== undefined || data.slug !== undefined, {
    message: 'At least one field (name or slug) must be provided',
  });

export type UpdateOrganizationDto = z.infer<typeof updateOrganizationSchema>;

// ============================================
// Agent Management Schemas
// ============================================

export const agentStatusEnum = z.enum(['ACTIVE', 'INACTIVE']);
export type AgentStatusEnum = z.infer<typeof agentStatusEnum>;

// Domain validation schemas
export const domainSchema = z
  .string()
  .min(1, 'Domain cannot be empty')
  .max(253, 'Domain too long')
  .transform((val) =>
    val
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*/, '')
      .replace(/\/$/, ''),
  );

export const allowedDomainsSchema = z
  .array(domainSchema)
  .max(50, 'Maximum 50 domains allowed')
  .default([]);

export const createAgentSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name must be at most 100 characters'),
  organizationId: z.string().uuid('Invalid organization ID'),
});

export type CreateAgentDto = z.infer<typeof createAgentSchema>;

// 24 categories per agent is well above any realistic taxonomy
// ("Pricing, Support, Refunds, Product, …"); names are kept short and
// non-empty so the LLM has something concrete to pick from. Trimming is
// applied via .transform so trailing spaces don't fragment analytics.
export const categoryKeywordSchema = z
  .string()
  .trim()
  .min(1, 'Category cannot be empty')
  .max(60, 'Category must be at most 60 characters');

export const categoryKeywordsSchema = z
  .array(categoryKeywordSchema)
  .max(24, 'At most 24 categories per agent')
  .default([]);

// Languages the agent owner wants conversations classified against. Mostly
// ISO 639-1 codes; `hinglish` is a non-standard sentinel for code-mixed
// Hindi-English (no ISO code exists for it). Kept as an enum so the agent
// editor's multi-select and the AI classifier's response schema both
// reference a single source of truth.
export const supportedLanguageEnum = z.enum([
  'en', 'hi', 'mr', 'bn', 'ta', 'te', 'gu', 'pa', 'kn', 'ml', 'ur',
  'es', 'fr', 'de', 'pt', 'it', 'nl', 'ja', 'ko', 'zh', 'ar', 'ru',
  'hinglish',
]);
export type SupportedLanguage = z.infer<typeof supportedLanguageEnum>;

export const supportedLanguagesSchema = z
  .array(supportedLanguageEnum)
  .max(15, 'At most 15 languages per agent')
  // The classifier de-dupes server-side anyway, but rejecting up front gives
  // a clearer error than a silent dedupe on save.
  .refine(
    (langs) => new Set(langs).size === langs.length,
    { message: 'Duplicate languages are not allowed' },
  )
  .default([]);

export const updateAgentSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name must be at most 100 characters').optional(),
    status: agentStatusEnum.optional(),
    allowedDomains: allowedDomainsSchema.optional(),
    voiceEnabled: z.boolean().optional(),
    voiceConfig: voiceConfigSchema.nullable().optional(),
    welcomeMessage: z.string().max(500).nullable().optional(),
    // 50K chars (~12K tokens) accommodates most persona + inline KB cases.
    // For larger knowledge bases, use AgentKnowledge (supports up to 500KB /
    // ~125K tokens) and let the chat pipeline append it at assembly time.
    systemPrompt: z.string().max(50000).nullable().optional(),
    aiConfig: agentAiConfigUpdateSchema.nullable().optional(),
    categoryKeywords: categoryKeywordsSchema.optional(),
    supportedLanguages: supportedLanguagesSchema.optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.status !== undefined ||
      data.allowedDomains !== undefined ||
      data.voiceEnabled !== undefined ||
      data.voiceConfig !== undefined ||
      data.welcomeMessage !== undefined ||
      data.systemPrompt !== undefined ||
      data.aiConfig !== undefined ||
      data.categoryKeywords !== undefined ||
      data.supportedLanguages !== undefined,
    { message: 'At least one field must be provided' },
  );

export type UpdateAgentDto = z.infer<typeof updateAgentSchema>;

export const agentListQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
  organizationId: z.string().uuid().optional(),
  status: agentStatusEnum.optional(),
  sortBy: z.enum(['name', 'createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type AgentListQuery = z.infer<typeof agentListQuerySchema>;

// Webhook configuration schemas
export const updateWebhookSchema = z.object({
  webhookUrl: z.string().url('Must be a valid URL'),
});

export type UpdateWebhookDto = z.infer<typeof updateWebhookSchema>;

// ============================================
// Utility Functions
// ============================================

/**
 * Validate data against a schema and throw if invalid
 */
export function validate<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown
): z.infer<T> {
  return schema.parse(data);
}

/**
 * Safely validate data against a schema
 */
export function safeValidate<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown
): z.SafeParseReturnType<unknown, z.infer<T>> {
  return schema.safeParse(data);
}
