-- Take the team surface away from org.owner.
--
-- Owners run their agents; they do not manage their teammates. Inviting is
-- already platform-only (org.owner never held Invitation:*), and now viewing the
-- roster goes too, so the Team nav item disappears for them entirely.
--
-- Team management stays a deliberate grant via org.manager, which keeps
-- Member:Read + Member:Manage. Whether that role is ever handed to a customer
-- remains a separate decision.
--
-- Their own profile is unaffected: /auth/users/me is @SelfOnly and needs no
-- permission.
DELETE FROM "role_permissions"
WHERE "role_key" = 'org.owner'
  AND "permission_key" IN ('Member:Read', 'User:Read');

-- Narrow it further: for now, ONLY platform.super_admin may invite, see the user
-- list, or change anyone's roles.
--
-- platform.ops and platform.support lose it too, so handing a staff member either
-- role no longer comes with user administration attached. org.manager is stripped
-- as well, leaving it a defined-but-empty role: the structure stays for when team
-- management is opened up, and re-filling it is one INSERT.
--
-- Nobody holds any of these three today, so no live user loses access.
DELETE FROM "role_permissions"
WHERE "role_key" <> 'platform.super_admin'
  AND "permission_key" IN (
    'Invitation:Create', 'Invitation:Read', 'Invitation:Update', 'Invitation:Delete',
    'Member:Read', 'Member:Manage',
    'User:Read', 'User:ReadAll', 'User:ManageScope',
    'Role:Read'
  );
