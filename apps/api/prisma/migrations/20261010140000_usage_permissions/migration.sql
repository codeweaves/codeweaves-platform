-- Super admin console, usage and cost pages (ADR-0012, plan PR 4).
--
-- Usage:Read   view the usage ledger, cost reports and the price list.
-- Price:Create add a new effective-dated row to the price list.
--
-- Both are platform-only (org_allowed = false): usage and cost cross every
-- organization, and the price list is our own supplier data. The role-purity
-- trigger (20260809000000_rbac_roles_permissions) stops any org role from ever
-- holding them.
--
-- Price:Create is held by the super admin only. Ops can read the prices but a
-- price row changes what every future call costs, so adding one stays with the
-- top role.

INSERT INTO "permissions" ("key", "resource", "action", "description", "org_allowed") VALUES
  ('Usage:Read',   'Usage', 'Read',   'View provider usage, costs and the price list', false),
  ('Price:Create', 'Price', 'Create', 'Add a new effective-dated price row',           false)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_key", "permission_key") VALUES
  ('platform.ops', 'Usage:Read')
ON CONFLICT DO NOTHING;

-- Super admin holds every permission.
INSERT INTO "role_permissions" ("role_key", "permission_key")
SELECT 'platform.super_admin', "key" FROM "permissions"
ON CONFLICT DO NOTHING;
