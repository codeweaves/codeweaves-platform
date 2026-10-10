/**
 * Audit scope from an optional organization. Null or missing passes no scope,
 * so a platform-level action (inviting platform staff, a system email) keeps
 * organizationId empty, or the acting user's org from the request context.
 */
export function auditScope(
  organizationId?: string | null,
): { organizationId: string } | undefined {
  return organizationId ? { organizationId } : undefined;
}
