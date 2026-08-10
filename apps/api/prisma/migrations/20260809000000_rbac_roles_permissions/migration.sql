-- RBAC: additive DB-backed roles with scope gating
--
-- A user holds any number of roles; their permissions are the union. Roles and
-- permissions are DATA seeded here, never created at runtime, so changing what a
-- role means is a migration and therefore a PR.
--
-- Order matters below: triggers are installed BEFORE the seed so the seed itself
-- is validated by them. A catalog that violates the org/platform split fails this
-- migration loudly instead of shipping a role whose flag lies about its contents.

-- ---------------------------------------------------------------------------
-- 1. Access scope
-- ---------------------------------------------------------------------------

CREATE TYPE "AccessScope" AS ENUM ('PLATFORM', 'ORG');

ALTER TABLE "users" ADD COLUMN "accessScope" "AccessScope" NOT NULL DEFAULT 'ORG';

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

CREATE TABLE "permissions" (
    "key"         VARCHAR(80)  NOT NULL,
    "resource"    VARCHAR(40)  NOT NULL,
    "action"      VARCHAR(20)  NOT NULL,
    "description" VARCHAR(300),
    "org_allowed" BOOLEAN      NOT NULL DEFAULT false,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "permissions_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "permissions_resource_idx"    ON "permissions"("resource");
CREATE INDEX "permissions_org_allowed_idx" ON "permissions"("org_allowed");

CREATE TABLE "roles" (
    "key"              VARCHAR(60)  NOT NULL,
    "name"             VARCHAR(120) NOT NULL,
    "description"      VARCHAR(300),
    "org_allowed"      BOOLEAN      NOT NULL DEFAULT false,
    "client_grantable" BOOLEAN      NOT NULL DEFAULT false,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "roles_org_allowed_idx" ON "roles"("org_allowed");

CREATE TABLE "role_permissions" (
    "role_key"       VARCHAR(60) NOT NULL,
    "permission_key" VARCHAR(80) NOT NULL,
    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_key", "permission_key")
);

CREATE INDEX "role_permissions_permission_key_idx" ON "role_permissions"("permission_key");

ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_role_key_fkey"
  FOREIGN KEY ("role_key") REFERENCES "roles"("key") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_permission_key_fkey"
  FOREIGN KEY ("permission_key") REFERENCES "permissions"("key") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "user_role_assignments" (
    "id"              TEXT         NOT NULL,
    "user_id"         TEXT         NOT NULL,
    "role_key"        VARCHAR(60)  NOT NULL,
    "organization_id" TEXT,
    "granted_by"      TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"      TIMESTAMP(3),
    CONSTRAINT "user_role_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_role_assignments_user_id_role_key_organization_id_key"
  ON "user_role_assignments"("user_id", "role_key", "organization_id");
CREATE INDEX "user_role_assignments_user_id_idx"         ON "user_role_assignments"("user_id");
CREATE INDEX "user_role_assignments_organization_id_idx" ON "user_role_assignments"("organization_id");
CREATE INDEX "user_role_assignments_role_key_idx"        ON "user_role_assignments"("role_key");

ALTER TABLE "user_role_assignments"
  ADD CONSTRAINT "user_role_assignments_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_role_assignments"
  ADD CONSTRAINT "user_role_assignments_role_key_fkey"
  FOREIGN KEY ("role_key") REFERENCES "roles"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "user_role_assignments"
  ADD CONSTRAINT "user_role_assignments_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Triggers
--
-- These are what make org_allowed real. Without them the flag is a comment: a
-- later migration could attach Organization:Delete to an org role and nothing
-- would object.
-- ---------------------------------------------------------------------------

-- 3a. An org-allowed role may only ever contain org-allowed permissions.
CREATE OR REPLACE FUNCTION assert_org_role_purity() RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT org_allowed FROM roles WHERE key = NEW.role_key)
     AND NOT (SELECT org_allowed FROM permissions WHERE key = NEW.permission_key)
  THEN
    RAISE EXCEPTION
      'org-allowed role % cannot contain platform-only permission %',
      NEW.role_key, NEW.permission_key;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_role_permission_purity
  BEFORE INSERT OR UPDATE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION assert_org_role_purity();

-- 3b. Opening a role to orgs re-checks everything already attached to it.
CREATE OR REPLACE FUNCTION assert_role_flip_safe() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.org_allowed AND NOT OLD.org_allowed AND EXISTS (
    SELECT 1
    FROM role_permissions rp
    JOIN permissions p ON p.key = rp.permission_key
    WHERE rp.role_key = NEW.key AND NOT p.org_allowed
  ) THEN
    RAISE EXCEPTION
      'cannot mark role % org-allowed: it holds platform-only permissions', NEW.key;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_role_flip_safe
  BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION assert_role_flip_safe();

-- 3c. Closing a permission to orgs must not strand an org-allowed role holding it.
CREATE OR REPLACE FUNCTION assert_permission_flip_safe() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.org_allowed AND NOT NEW.org_allowed AND EXISTS (
    SELECT 1
    FROM role_permissions rp
    JOIN roles r ON r.key = rp.role_key
    WHERE rp.permission_key = NEW.key AND r.org_allowed
  ) THEN
    RAISE EXCEPTION
      'cannot close permission % to orgs: org-allowed roles still hold it', NEW.key;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_permission_flip_safe
  BEFORE UPDATE ON permissions
  FOR EACH ROW EXECUTE FUNCTION assert_permission_flip_safe();

-- 3d. An ORG-scope account can never be assigned a role that is not org-allowed.
CREATE OR REPLACE FUNCTION assert_assignment_scope() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deleted_at IS NULL
     AND (SELECT "accessScope" FROM users WHERE id = NEW.user_id) = 'ORG'
     AND NOT (SELECT org_allowed FROM roles WHERE key = NEW.role_key)
  THEN
    RAISE EXCEPTION
      'ORG-scope user % cannot hold platform role %', NEW.user_id, NEW.role_key;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_assignment_scope
  BEFORE INSERT OR UPDATE ON user_role_assignments
  FOR EACH ROW EXECUTE FUNCTION assert_assignment_scope();

-- ---------------------------------------------------------------------------
-- 4. Permission catalog
--
-- org_allowed = true means an ORG account MAY reach it through some role. It is
-- not a grant on its own. Anything omitted defaults to false, so forgetting a
-- row fails closed.
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("key", "resource", "action", "description", "org_allowed") VALUES
  -- Agent and configuration
  ('Agent:Create',            'Agent',            'Create',      'Create an agent',                              false),
  ('Agent:Read',              'Agent',            'Read',        'View an agent',                                true),
  ('Agent:ReadAll',           'Agent',            'ReadAll',     'List agents across organizations',             false),
  ('Agent:Update',            'Agent',            'Update',      'Edit agent settings, behaviour and voice',     true),
  ('Agent:Delete',            'Agent',            'Delete',      'Delete an agent',                              true),
  ('Agent:Export',            'Agent',            'Export',      'Export agent data',                            false),
  ('AgentTheme:Read',         'AgentTheme',       'Read',        'View widget appearance',                       true),
  ('AgentTheme:Update',       'AgentTheme',       'Update',      'Edit appearance and chat interface',           true),
  ('AgentKnowledge:Read',     'AgentKnowledge',   'Read',        'View the knowledge base',                      true),
  ('AgentKnowledge:Update',   'AgentKnowledge',   'Update',      'Edit the knowledge base',                      true),
  ('AgentKnowledge:Delete',   'AgentKnowledge',   'Delete',      'Clear the knowledge base',                     true),
  ('File:Create',             'File',             'Create',      'Upload a file to an agent',                    true),
  ('File:Delete',             'File',             'Delete',      'Delete an agent file',                         true),
  ('AgentSecret:Read',        'AgentSecret',      'Read',        'View the integration webhook URL',             false),
  ('AgentSecret:Update',      'AgentSecret',      'Update',      'Set or test the integration webhook',          false),
  ('AgentDataField:Read',     'AgentDataField',   'Read',        'View data-capture field definitions',          false),
  ('AgentDataField:Update',   'AgentDataField',   'Update',      'Edit data-capture field definitions',          false),
  ('WhatsappChannel:Read',    'WhatsappChannel',  'Read',        'View WhatsApp channel configuration',          false),
  ('WhatsappChannel:Create',  'WhatsappChannel',  'Create',      'Connect a WhatsApp number',                    false),
  ('WhatsappChannel:Update',  'WhatsappChannel',  'Update',      'Change WhatsApp channel settings',             false),
  ('WhatsappChannel:Delete',  'WhatsappChannel',  'Delete',      'Disconnect a WhatsApp number',                 false),

  -- Operations
  ('CollectedData:Read',      'CollectedData',    'Read',        'View data captured from conversations',        true),
  ('ChatSession:Read',        'ChatSession',      'Read',        'View conversations',                           true),
  ('Handover:Read',           'Handover',         'Read',        'View the live inbox',                          true),
  ('Handover:Take',           'Handover',         'Take',        'Take over a live conversation',                true),
  ('Handover:Reply',          'Handover',         'Reply',       'Reply as a human agent',                       true),
  ('Handover:Resolve',        'Handover',         'Resolve',     'Resolve a handover',                           true),
  ('Analytics:Read',          'Analytics',        'Read',        'View analytics',                               true),
  ('Analytics:Export',        'Analytics',        'Export',      'Export analytics',                             true),
  ('Notification:Read',       'Notification',     'Read',        'View notifications',                           true),
  ('Notification:Update',     'Notification',     'Update',      'Mark notifications read',                      true),
  ('Voice:Read',              'Voice',            'Read',        'List and preview TTS voices',                  true),

  -- Administration
  ('Organization:Create',     'Organization',     'Create',      'Create an organization',                       false),
  ('Organization:Read',       'Organization',     'Read',        'View an organization',                         true),
  ('Organization:ReadAll',    'Organization',     'ReadAll',     'List all organizations',                       false),
  ('Organization:Update',     'Organization',     'Update',      'Edit an organization',                         false),
  ('Organization:Delete',     'Organization',     'Delete',      'Delete an organization',                       false),
  ('User:Read',               'User',             'Read',        'View a user',                                  true),
  ('User:ReadAll',            'User',             'ReadAll',     'List users across organizations',              false),
  ('User:ManageScope',        'User',             'ManageScope', 'Change a user access scope',                   false),
  ('Member:Read',             'Member',           'Read',        'View organization members',                    true),
  ('Member:Manage',           'Member',           'Manage',      'Assign roles to organization members',         true),
  ('Role:Read',               'Role',             'Read',        'View the role catalog',                        true),
  ('Invitation:Create',       'Invitation',       'Create',      'Invite a user',                                false),
  ('Invitation:Read',         'Invitation',       'Read',        'View invitations',                             false),
  ('Invitation:Update',       'Invitation',       'Update',      'Resend an invitation',                         false),
  ('Invitation:Delete',       'Invitation',       'Delete',      'Cancel an invitation',                         false),
  ('Privacy:Read',            'Privacy',          'Read',        'View a visitor data summary',                  true),
  ('Privacy:Delete',          'Privacy',          'Delete',      'Erase a visitor',                              true),
  ('Privacy:DeleteOrg',       'Privacy',          'DeleteOrg',   'Erase an entire organization',                 false),
  ('EmailTemplate:Read',      'EmailTemplate',    'Read',        'View email templates',                         false),
  ('EmailTemplate:Update',    'EmailTemplate',    'Update',      'Edit email templates',                         false),
  ('AuditLog:Read',           'AuditLog',         'Read',        'View audit logs',                              false);

-- ---------------------------------------------------------------------------
-- 5. Role catalog
--
-- client_grantable = may an org manager hand this out. org.manager is
-- org_allowed but NOT client_grantable, which is what stops a manager creating
-- another manager.
-- ---------------------------------------------------------------------------

INSERT INTO "roles" ("key", "name", "description", "org_allowed", "client_grantable") VALUES
  ('platform.super_admin', 'Super Admin',    'Full access to everything on the platform',        false, false),
  ('platform.support',     'Support',        'Read agents, conversations and analytics anywhere', false, false),
  ('platform.ops',         'Platform Ops',   'Manage organizations, invitations and templates',  false, false),
  ('platform.privacy',     'Privacy Officer','Run data-erasure and privacy requests',            false, false),
  ('platform.agent_admin', 'Agent Admin',    'Create agents and manage integrations anywhere',   false, false),

  ('org.owner',            'Owner',          'Full control of this organization',                true,  false),
  ('org.manager',          'Manager',        'Manage teammates and their roles',                 true,  false),
  ('org.agent_editor',     'Agent Editor',   'Edit agent settings, prompt, knowledge and theme', true,  true),
  ('org.inbox_agent',      'Inbox Agent',    'Take over, reply to and resolve live chats',       true,  true),
  ('org.analyst',          'Analyst',        'Read and export analytics and conversations',      true,  true),
  ('org.viewer',           'Viewer',         'Read-only access',                                 true,  true),
  -- Defined but CLOSED: every permission it grants is platform-only, so the
  -- purity trigger would reject org_allowed = true until those are opened first.
  -- Opening this to customers is a deliberate two-step migration.
  ('org.integrations',     'Integrations',   'Manage webhooks, secrets and WhatsApp',            false, true);

-- Platform super admin holds every permission, including org-scoped ones.
INSERT INTO "role_permissions" ("role_key", "permission_key")
SELECT 'platform.super_admin', key FROM "permissions";

INSERT INTO "role_permissions" ("role_key", "permission_key") VALUES
  -- platform.support: read-only, cross-org
  ('platform.support', 'Agent:Read'),
  ('platform.support', 'Agent:ReadAll'),
  ('platform.support', 'ChatSession:Read'),
  ('platform.support', 'Analytics:Read'),
  ('platform.support', 'User:Read'),
  ('platform.support', 'User:ReadAll'),
  ('platform.support', 'Member:Read'),
  ('platform.support', 'Organization:Read'),
  ('platform.support', 'Organization:ReadAll'),
  ('platform.support', 'Notification:Read'),

  -- platform.ops
  ('platform.ops', 'Organization:Create'),
  ('platform.ops', 'Organization:Read'),
  ('platform.ops', 'Organization:ReadAll'),
  ('platform.ops', 'Organization:Update'),
  ('platform.ops', 'Organization:Delete'),
  ('platform.ops', 'Invitation:Create'),
  ('platform.ops', 'Invitation:Read'),
  ('platform.ops', 'Invitation:Update'),
  ('platform.ops', 'Invitation:Delete'),
  ('platform.ops', 'EmailTemplate:Read'),
  ('platform.ops', 'EmailTemplate:Update'),
  ('platform.ops', 'User:Read'),
  ('platform.ops', 'User:ReadAll'),
  ('platform.ops', 'Member:Read'),
  ('platform.ops', 'Member:Manage'),
  ('platform.ops', 'Role:Read'),
  ('platform.ops', 'AuditLog:Read'),

  -- platform.privacy
  ('platform.privacy', 'Privacy:Read'),
  ('platform.privacy', 'Privacy:Delete'),
  ('platform.privacy', 'Privacy:DeleteOrg'),

  -- platform.agent_admin
  ('platform.agent_admin', 'Agent:Create'),
  ('platform.agent_admin', 'Agent:Read'),
  ('platform.agent_admin', 'Agent:ReadAll'),
  ('platform.agent_admin', 'Agent:Update'),
  ('platform.agent_admin', 'Agent:Delete'),
  ('platform.agent_admin', 'Agent:Export'),
  ('platform.agent_admin', 'AgentSecret:Read'),
  ('platform.agent_admin', 'AgentSecret:Update'),
  ('platform.agent_admin', 'AgentDataField:Read'),
  ('platform.agent_admin', 'AgentDataField:Update'),
  ('platform.agent_admin', 'WhatsappChannel:Read'),
  ('platform.agent_admin', 'WhatsappChannel:Create'),
  ('platform.agent_admin', 'WhatsappChannel:Update'),
  ('platform.agent_admin', 'WhatsappChannel:Delete'),

  -- org.owner: exactly the agreed client capability. No Agent:Create, no
  -- secrets, no WhatsApp, no data-capture config. Branding is withheld inside
  -- AgentTheme:Update at the service layer, since the whole theme is one JSONB
  -- column and cannot be split by permission.
  ('org.owner', 'Agent:Read'),
  ('org.owner', 'Agent:Update'),
  ('org.owner', 'Agent:Delete'),
  ('org.owner', 'AgentTheme:Read'),
  ('org.owner', 'AgentTheme:Update'),
  ('org.owner', 'AgentKnowledge:Read'),
  ('org.owner', 'AgentKnowledge:Update'),
  ('org.owner', 'AgentKnowledge:Delete'),
  ('org.owner', 'File:Create'),
  ('org.owner', 'File:Delete'),
  ('org.owner', 'Voice:Read'),
  ('org.owner', 'CollectedData:Read'),
  ('org.owner', 'ChatSession:Read'),
  ('org.owner', 'Handover:Read'),
  ('org.owner', 'Handover:Take'),
  ('org.owner', 'Handover:Reply'),
  ('org.owner', 'Handover:Resolve'),
  ('org.owner', 'Analytics:Read'),
  ('org.owner', 'Analytics:Export'),
  ('org.owner', 'Notification:Read'),
  ('org.owner', 'Notification:Update'),
  ('org.owner', 'Member:Read'),
  ('org.owner', 'User:Read'),
  ('org.owner', 'Organization:Read'),
  ('org.owner', 'Privacy:Read'),
  ('org.owner', 'Privacy:Delete'),

  -- org.manager
  ('org.manager', 'Member:Read'),
  ('org.manager', 'Member:Manage'),
  ('org.manager', 'Role:Read'),
  ('org.manager', 'User:Read'),

  -- org.agent_editor
  ('org.agent_editor', 'Agent:Read'),
  ('org.agent_editor', 'Agent:Update'),
  ('org.agent_editor', 'AgentTheme:Read'),
  ('org.agent_editor', 'AgentTheme:Update'),
  ('org.agent_editor', 'AgentKnowledge:Read'),
  ('org.agent_editor', 'AgentKnowledge:Update'),
  ('org.agent_editor', 'AgentKnowledge:Delete'),
  ('org.agent_editor', 'File:Create'),
  ('org.agent_editor', 'File:Delete'),
  ('org.agent_editor', 'Voice:Read'),
  ('org.agent_editor', 'Notification:Read'),

  -- org.inbox_agent
  ('org.inbox_agent', 'Handover:Read'),
  ('org.inbox_agent', 'Handover:Take'),
  ('org.inbox_agent', 'Handover:Reply'),
  ('org.inbox_agent', 'Handover:Resolve'),
  ('org.inbox_agent', 'ChatSession:Read'),
  ('org.inbox_agent', 'Agent:Read'),
  ('org.inbox_agent', 'Notification:Read'),
  ('org.inbox_agent', 'Notification:Update'),

  -- org.analyst
  ('org.analyst', 'Analytics:Read'),
  ('org.analyst', 'Analytics:Export'),
  ('org.analyst', 'ChatSession:Read'),
  ('org.analyst', 'CollectedData:Read'),
  ('org.analyst', 'Agent:Read'),

  -- org.viewer
  ('org.viewer', 'Agent:Read'),
  ('org.viewer', 'ChatSession:Read'),
  ('org.viewer', 'Analytics:Read'),
  ('org.viewer', 'Notification:Read'),

  -- org.integrations (role is closed to orgs; see the roles insert above)
  ('org.integrations', 'AgentSecret:Read'),
  ('org.integrations', 'AgentSecret:Update'),
  ('org.integrations', 'WhatsappChannel:Read'),
  ('org.integrations', 'WhatsappChannel:Create'),
  ('org.integrations', 'WhatsappChannel:Update'),
  ('org.integrations', 'WhatsappChannel:Delete'),
  ('org.integrations', 'AgentDataField:Read'),
  ('org.integrations', 'AgentDataField:Update');

-- ---------------------------------------------------------------------------
-- 6. Backfill
--
-- Behaviour-preserving: every existing account is granted the role set matching
-- what it can already do, so nobody's effective access changes on deploy.
-- ---------------------------------------------------------------------------

UPDATE "users"
SET "accessScope" = CASE
  WHEN "role" IN ('SUPER_ADMIN', 'ADMIN') THEN 'PLATFORM'::"AccessScope"
  ELSE 'ORG'::"AccessScope"
END;

-- Existing CLIENTs are the sole member of their org today and already hold full
-- rights over it, so org.owner is the behaviour-preserving mapping.
INSERT INTO "user_role_assignments" ("id", "user_id", "role_key", "organization_id")
SELECT gen_random_uuid()::text, u."id", 'org.owner', u."organizationId"
FROM "users" u
WHERE u."role" = 'CLIENT'
  AND u."organizationId" IS NOT NULL
  AND u."deletedAt" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "user_role_assignments" ("id", "user_id", "role_key", "organization_id")
SELECT gen_random_uuid()::text, u."id", 'platform.super_admin', NULL
FROM "users" u
WHERE u."role" = 'SUPER_ADMIN' AND u."deletedAt" IS NULL
ON CONFLICT DO NOTHING;

-- Platform staff keep the cross-org capability they have today.
INSERT INTO "user_role_assignments" ("id", "user_id", "role_key", "organization_id")
SELECT gen_random_uuid()::text, u."id", r.key, NULL
FROM "users" u
CROSS JOIN (VALUES
  ('platform.support'), ('platform.ops'), ('platform.privacy'), ('platform.agent_admin')
) AS r(key)
WHERE u."role" = 'ADMIN' AND u."deletedAt" IS NULL
ON CONFLICT DO NOTHING;
