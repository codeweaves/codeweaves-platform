import { z } from 'zod';
import { EMAIL_TEMPLATE_KEYS } from '../services/email-template.registry';

/**
 * Template keys are a closed set defined in the registry — the route param is
 * validated against it so an unknown key is a 400 at the edge rather than a
 * lookup miss deeper in.
 */
export const emailTemplateKeyParamsSchema = z.object({
  key: z.enum(EMAIL_TEMPLATE_KEYS as [string, ...string[]]),
});
export type EmailTemplateKeyParams = z.infer<typeof emailTemplateKeyParamsSchema>;

/**
 * Update payload. Only subject + html are editable: `key` identifies the row
 * the code calls and `name`/`description` label it in the UI, so neither is
 * something an edit should be able to move.
 *
 * The 200KB html ceiling is a guard against a paste (or a paste loop) writing
 * an unbounded blob into a row that is read on the email hot path.
 */
export const updateEmailTemplateSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  html: z.string().min(1).max(200_000),
});
export type UpdateEmailTemplateDto = z.infer<typeof updateEmailTemplateSchema>;
