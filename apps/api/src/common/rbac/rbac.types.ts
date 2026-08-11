/**
 * The vocabulary a @RequirePermission decorator draws on.
 *
 * These enums exist for compile-time safety at the call site: `Resource.Agent`
 * cannot be misspelled the way a bare string can. They are NOT the source of
 * truth for what exists — that is the `permissions` table, seeded by migration.
 * RouteAuthorizationAssertion reconciles the two at boot and refuses to start
 * the app if a decorator names a key with no row behind it.
 *
 * Adding a value here without also adding the matching row in a migration is
 * therefore a boot failure, not a silent grant.
 */
export enum Resource {
  // Agent and configuration
  Agent = 'Agent',
  AgentTheme = 'AgentTheme',
  AgentKnowledge = 'AgentKnowledge',
  AgentSecret = 'AgentSecret',
  AgentDataField = 'AgentDataField',
  WhatsappChannel = 'WhatsappChannel',
  File = 'File',
  Voice = 'Voice',

  // Operations
  CollectedData = 'CollectedData',
  ChatSession = 'ChatSession',
  ChatMessage = 'ChatMessage',
  Handover = 'Handover',
  Analytics = 'Analytics',
  Notification = 'Notification',

  // Administration
  Organization = 'Organization',
  User = 'User',
  Member = 'Member',
  Role = 'Role',
  Invitation = 'Invitation',
  Privacy = 'Privacy',
  EmailTemplate = 'EmailTemplate',
  AuditLog = 'AuditLog',
}

export enum Action {
  Create = 'Create',
  Read = 'Read',
  /** Read across organizations, i.e. beyond the caller's own tenant. */
  ReadAll = 'ReadAll',
  Update = 'Update',
  Delete = 'Delete',
  Export = 'Export',

  // Verbs that do not map onto CRUD.
  /** Take over a live conversation. */
  Take = 'Take',
  /** Reply as a human agent. */
  Reply = 'Reply',
  /** Close out a handover. */
  Resolve = 'Resolve',
  /** Administer other people's roles. */
  Manage = 'Manage',

  /*
   * Section-level writes on the agent.
   *
   * `PATCH /agents/:id` writes prompt, handover and core config in one call, and
   * the theme keeps appearance, chat interface and branding in one JSONB column.
   * A permission can gate a call; it cannot gate which keys inside one value a
   * caller may set. So these are checked field-by-field in the services, which is
   * why they read as verbs on a slice rather than plain Update.
   */
  UpdatePrompt = 'UpdatePrompt',
  UpdateHandover = 'UpdateHandover',
  UpdateIntegration = 'UpdateIntegration',
  UpdateBranding = 'UpdateBranding',
  /** Change a user's access scope. Platform-only. */
  ManageScope = 'ManageScope',
  /** Erase an entire organization. Distinct from Delete on a single subject. */
  DeleteOrg = 'DeleteOrg',
}

/**
 * Shape of a permission key. Not every combination exists; the `permissions`
 * table decides which do.
 */
export type PermissionKey = `${Resource}:${Action}`;

/**
 * The one role key with meaning outside the permission catalog.
 *
 * A handful of actions are deliberately narrower than the permission that
 * unlocks the route: seizing a conversation another teammate is handling, and
 * erasing an organization with everything under it. Those permissions sit on
 * other platform roles too, so the extra check names the role directly.
 *
 * Prefer a permission wherever one will do. Reach for this only where the rule
 * genuinely is "the top role and nobody else", and never read the deprecated
 * `User.role` column: a role set tracks what an account holds today, and
 * `PATCH /users/:id/scope` leaves that old column stale on purpose.
 */
export const SUPER_ADMIN_ROLE_KEY = 'platform.super_admin';

/** Does this account hold the super-admin role right now? */
export function isSuperAdmin(user: { roleKeys?: string[] | null }): boolean {
  return (user.roleKeys ?? []).includes(SUPER_ADMIN_ROLE_KEY);
}
