/**
 * Validation schemas for per-agent "data capture" fields — the customer-defined
 * list of things a bot should collect from a conversation (e.g. name/email/phone
 * for a sales bot, employeeId for an HR bot). See `AgentDataField` +
 * `CollectedData` in the Prisma schema, and
 * docs/plans/agent-data-and-integrations-plan.md for the design.
 *
 * Values are captured OUT OF BAND by a background extractor (never on the reply
 * hot path), so nothing here touches chat latency.
 */
import { z } from 'zod';

// ============================================
// Limits
// ============================================

/**
 * Max fields one agent can collect. Kept modest: each field is a line in the
 * system prompt and a property in the extractor's schema, so a huge list both
 * bloats the prompt and hurts extraction accuracy. 30 covers every realistic
 * lead/HR/support form.
 */
export const MAX_DATA_FIELDS = 30;

/** Max length of a field's natural-language description / extraction hint. */
export const MAX_DATA_FIELD_DESCRIPTION = 500;

// ============================================
// Field value types (mirror the Prisma `DataFieldType` enum)
// ============================================

export const DATA_FIELD_TYPES = [
  'STRING',
  'NUMBER',
  'BOOLEAN',
  'DATE',
  'EMAIL',
  'PHONE',
] as const;

export const dataFieldTypeEnum = z.enum(DATA_FIELD_TYPES);
export type DataFieldType = z.infer<typeof dataFieldTypeEnum>;

// ============================================
// Single field definition
// ============================================

/**
 * Machine name used as the JSON key in `CollectedData.data` and as the property
 * name in the extractor's schema. Restricted to a safe identifier: starts with
 * a lowercase letter, then lowercase letters/digits/underscores. Immutable once
 * created on the backend (renaming would orphan historical values).
 */
export const dataFieldKeySchema = z
  .string()
  .min(1, 'Field key is required')
  .max(64, 'Field key must be at most 64 characters')
  .regex(
    /^[a-z][a-z0-9_]*$/,
    'Field key must start with a lowercase letter and contain only lowercase letters, digits, and underscores (e.g. "email", "order_id")',
  );

export const dataFieldSchema = z.object({
  key: dataFieldKeySchema,
  label: z
    .string()
    .min(1, 'Field label is required')
    .max(100, 'Field label must be at most 100 characters'),
  type: dataFieldTypeEnum.default('STRING'),
  /** Whether the agent should proactively ask for this if not volunteered. */
  required: z.boolean().default(false),
  /** Optional hint to help the extractor pull the right value. */
  description: z
    .string()
    .max(
      MAX_DATA_FIELD_DESCRIPTION,
      `Description must be at most ${MAX_DATA_FIELD_DESCRIPTION} characters`,
    )
    .nullable()
    .optional(),
});

export type DataFieldDto = z.infer<typeof dataFieldSchema>;

// ============================================
// Replace-all update (PUT /agents/:id/data-fields)
// ============================================

/**
 * Schema for PUT /agents/:id/data-fields — replaces the agent's entire field
 * list (the editor sends the whole list, like conversation starters). Order is
 * taken from array position. Keys must be unique within the list. An empty list
 * disables data capture for the agent (no prompt injection, no extractor run).
 */
export const updateDataFieldsSchema = z.object({
  fields: z
    .array(dataFieldSchema)
    .max(MAX_DATA_FIELDS, `At most ${MAX_DATA_FIELDS} fields per agent`)
    .superRefine((fields, ctx) => {
      const seen = new Set<string>();
      fields.forEach((field, index) => {
        if (seen.has(field.key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate field key "${field.key}" — each key must be unique`,
            path: [index, 'key'],
          });
        }
        seen.add(field.key);
      });
    }),
});

export type UpdateDataFieldsDto = z.infer<typeof updateDataFieldsSchema>;

// ============================================
// Response / DTO shapes (for OpenAPI + client types)
// ============================================

export const dataFieldResponseSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  key: z.string(),
  label: z.string(),
  type: dataFieldTypeEnum,
  required: z.boolean(),
  description: z.string().nullable(),
  order: z.number().int(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type DataFieldResponse = z.infer<typeof dataFieldResponseSchema>;

/**
 * One conversation's captured values. `data` is a flat object keyed by field
 * `key`; values are strings/numbers/booleans/null depending on the field type
 * (kept loose here since the shape is per-agent dynamic).
 */
export const collectedDataResponseSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  chatSessionId: z.string().uuid(),
  data: z.record(z.string(), z.unknown()),
  extractedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type CollectedDataResponse = z.infer<typeof collectedDataResponseSchema>;
