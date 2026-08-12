-- Give platform.agent_admin the ability to list organizations.
--
-- The role grants `Agent:Create`, but creating an agent REQUIRES choosing an
-- organization: the dialog posts `{ name, organizationId }` and refuses to
-- submit without one. The org picker is fed by `GET /organizations`, which needs
-- `Organization:ReadAll` — a permission this role never held.
--
-- So anyone holding platform.agent_admin ALONE could open Create Agent, see an
-- empty dropdown, and never get past "Please select an organization". Nobody has
-- hit it yet only because platform.super_admin is seeded with every permission,
-- and that is the only account anyone has used so far. The role is unusable for
-- its stated purpose the moment it is granted on its own.
--
-- The same permission also restores the Organization filter on the agents list,
-- which the role's `Agent:ReadAll` makes meaningful (it sees every org's agents,
-- so it is exactly who needs to filter by org).
--
-- `Organization:Read` is deliberately NOT granted: that gates the single-org
-- detail page, which is org administration and belongs to platform.ops.
--
-- Safe against the purity trigger: platform.agent_admin is org_allowed = false,
-- so it may hold a platform-only permission.
INSERT INTO "role_permissions" ("role_key", "permission_key")
VALUES ('platform.agent_admin', 'Organization:ReadAll')
ON CONFLICT ("role_key", "permission_key") DO NOTHING;
