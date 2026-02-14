import { z } from 'zod';
import { Role } from '@prisma/client';

export const createInvitationSchema = z.object({
  email: z.string().email(),
  role: z.nativeEnum(Role),
  organizationId: z.string().uuid(),
});

export type CreateInvitationDto = z.infer<typeof createInvitationSchema>;

export const reissueInvitationSchema = z.object({
  reissueToken: z.string().uuid(),
});

export type ReissueInvitationDto = z.infer<typeof reissueInvitationSchema>;
