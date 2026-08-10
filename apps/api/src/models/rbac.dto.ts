import { z } from 'zod';
import { AccessScope } from '@prisma/client';

/** Role keys are catalog identifiers like `org.agent_editor`. */
const roleKeySchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, 'Invalid role key');

/**
 * Full replacement of a user's role set, matching the checkbox dialog which
 * submits everything ticked. Replace semantics avoid a lost update when two
 * managers edit the same person; the handler diffs against current state to
 * produce the audit entry.
 *
 * At least one role is required. A user with an empty set would keep their login
 * but see an empty dashboard, which reads as a broken account rather than a
 * revoked one — revocation is done by deactivating the user, not by emptying it.
 */
export const setUserRolesSchema = z.object({
  roleKeys: z
    .array(roleKeySchema)
    .min(1, 'A user must hold at least one role')
    .max(20)
    // Duplicate keys are harmless to resolution (it is a union) but would create
    // a misleading audit diff, so normalize here.
    .transform((keys) => [...new Set(keys)]),
});
export type SetUserRolesDto = z.infer<typeof setUserRolesSchema>;

/** Platform tier. Deliberately a separate endpoint from the role dialog. */
export const setAccessScopeSchema = z.object({
  accessScope: z.nativeEnum(AccessScope),
});
export type SetAccessScopeDto = z.infer<typeof setAccessScopeSchema>;

export const userListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  organizationId: z.string().uuid().optional(),
  accessScope: z.nativeEnum(AccessScope).optional(),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

export const userIdParamsSchema = z.object({ id: z.string().uuid() });
export type UserIdParams = z.infer<typeof userIdParamsSchema>;

export interface RoleView {
  key: string;
  name: string;
  description: string | null;
  orgAllowed: boolean;
  clientGrantable: boolean;
  permissions: readonly string[];
}

export interface UserListItem {
  id: string;
  email: string;
  name: string | null;
  accessScope: AccessScope;
  organization: { id: string; name: string; slug: string } | null;
  roleKeys: string[];
  createdAt: Date;
}

export interface UserDetail extends UserListItem {
  /** Union of everything the held roles grant. Read-only, derived. */
  permissions: string[];
}
