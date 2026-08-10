-- Drop org.manager and stop requiring an owner per organization.
--
-- org.manager existed to let a customer administer their own teammates. The
-- previous migration moved every team/invite/user permission to
-- platform.super_admin only, which left org.manager holding nothing — a role you
-- could still assign that granted nothing at all. Better removed than left as a
-- trap. Re-adding it later is one INSERT plus its permission rows.
--
-- The paired code change drops assertNotLastOwner from UserRolesService: an
-- organization no longer has to keep at least one org.owner. org.owner remains a
-- normal role carrying the full agent capability, just not a mandatory one.
DELETE FROM "user_role_assignments" WHERE "role_key" = 'org.manager';
DELETE FROM "roles" WHERE "key" = 'org.manager';
