/**
 * Human labels for the roles an account holds. Display only — never a gate.
 * Use `usePermissions()` for anything that decides what renders.
 *
 * Role keys are `<scope>.<name>` (e.g. `platform.super_admin`, `org.prompt`) and
 * are the source of truth in the DB catalog. The browser gets the keys, not the
 * catalog's display names, so it prettifies the key's last segment rather than
 * carrying a second copy of the names that would drift when a role is renamed.
 */
export function formatRoleKey(roleKey: string): string {
  const name = roleKey.includes('.') ? roleKey.slice(roleKey.indexOf('.') + 1) : roleKey;
  return name
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * One line describing who this account is, for the avatar menu and profile page.
 *
 * Roles are additive, so a person can hold several. Listing them all would run
 * off a dropdown, so beyond two we name the first and count the rest. Accounts
 * with no roles yet still get their scope, which is never empty.
 */
export function accountRoleLabel(
  profile: { accessScope?: string; roleKeys?: string[] } | null | undefined,
): string | null {
  if (!profile) return null;

  const keys = profile.roleKeys ?? [];
  if (keys.length === 0) {
    return profile.accessScope === 'PLATFORM' ? 'Platform' : 'Organization';
  }
  if (keys.length <= 2) return keys.map(formatRoleKey).join(', ');
  return `${formatRoleKey(keys[0]!)} +${keys.length - 1} more`;
}
