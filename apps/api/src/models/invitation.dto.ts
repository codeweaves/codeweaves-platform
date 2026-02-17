import { z } from 'zod';
import { InvitationStatus, Role } from '@prisma/client';
import { paginationSchema } from '@repo/validation';

export const createInvitationSchema = z
  .object({
    email: z.string().email(),
    role: z.nativeEnum(Role),
    organizationId: z.string().uuid().optional(),
  })
  .refine(
    (data) => {
      if (data.role === Role.CLIENT) return !!data.organizationId;
      return true;
    },
    { message: 'Organization is required for client role', path: ['organizationId'] },
  )
  .refine(
    (data) => {
      if (data.role === Role.ADMIN || data.role === Role.SUPER_ADMIN) return !data.organizationId;
      return true;
    },
    { message: 'Organization must not be provided for admin or super admin role', path: ['organizationId'] },
  );

export type CreateInvitationDto = z.infer<typeof createInvitationSchema>;

export const reissueInvitationSchema = z.object({
  reissueToken: z.string().uuid(),
});

export type ReissueInvitationDto = z.infer<typeof reissueInvitationSchema>;

export const invitationListQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
  status: z.nativeEnum(InvitationStatus).optional(),
  sortBy: z.enum(['email', 'status', 'createdAt', 'expiresAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type InvitationListQuery = z.infer<typeof invitationListQuerySchema>;
