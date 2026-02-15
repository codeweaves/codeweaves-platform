/**
 * @repo/validation
 * Shared Zod schemas for validation across frontend and backend
 */
import { z } from 'zod';

// Re-export zod for convenience
export { z } from 'zod';

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
  name: z.string().min(2).max(100).optional(),
});

export type UpdateUserProfileDto = z.infer<typeof updateUserProfileSchema>;

export const organizationSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
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
