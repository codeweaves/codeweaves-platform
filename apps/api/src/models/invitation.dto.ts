import { z } from 'zod';
import { InvitationStatus, Role } from '@prisma/client';
import { paginationSchema } from '@repo/validation';

/**
 * Invitations carry the role set the account starts with, chosen when the invite
 * is sent. Without this every invited client was provisioned as `org.owner`,
 * because signup could only map the legacy three-value `role` enum — so
 * "inbox agent only" was impossible to invite and had to be a demotion after
 * the fact.
 *
 * `role` stays as the legacy tier for pending pre-RBAC invitations. Whether the
 * invite is org- or platform-scoped is derived from the chosen roles in the
 * service, so it needs no field of its own.
 */
export const createInvitationSchema = z
  .object({
    email: z.string().email(),
    role: z.nativeEnum(Role).optional(),
    roleKeys: z
      .array(z.string().min(1).max(60))
      .min(1, 'Select at least one role')
      .max(20)
      .transform((keys) => [...new Set(keys)]),
    organizationId: z.string().uuid().optional(),
  })
  .refine(
    (data) => data.roleKeys.every((k) => k.startsWith('org.')) || !data.organizationId,
    {
      message: 'Organization must not be provided when inviting to a platform role',
      path: ['organizationId'],
    },
  )
  .refine(
    (data) => !data.roleKeys.every((k) => k.startsWith('org.')) || !!data.organizationId,
    {
      message: 'Organization is required when inviting to an organization role',
      path: ['organizationId'],
    },
  )
  .refine(
    // Mixing scopes would leave the account impossible to scope coherently: an
    // ORG user cannot hold a platform role, and the assignment trigger rejects it.
    (data) =>
      data.roleKeys.every((k) => k.startsWith('org.')) ||
      data.roleKeys.every((k) => !k.startsWith('org.')),
    {
      message: 'An invitation cannot mix organization and platform roles',
      path: ['roleKeys'],
    },
  );

export type CreateInvitationDto = z.infer<typeof createInvitationSchema>;

export const reissueInvitationSchema = z.object({
  reissueToken: z.string().uuid(),
});

export type ReissueInvitationDto = z.infer<typeof reissueInvitationSchema>;

export const invitationListQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
  /** Single status filter (legacy / single-select callers) */
  status: z.nativeEnum(InvitationStatus).optional(),
  /** Multi-status filter (comma-separated). Combined with `status` server-side. */
  statuses: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.nativeEnum(InvitationStatus)).optional()),
  sortBy: z.enum(['email', 'status', 'createdAt', 'expiresAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type InvitationListQuery = z.infer<typeof invitationListQuerySchema>;
