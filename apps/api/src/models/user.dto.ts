import { z } from 'zod';
import { Role } from '@prisma/client';

export const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
});

export type UpdateUserDto = z.infer<typeof updateUserSchema>;

export const userResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: z.nativeEnum(Role),
  organizationId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type UserResponse = z.infer<typeof userResponseSchema>;
