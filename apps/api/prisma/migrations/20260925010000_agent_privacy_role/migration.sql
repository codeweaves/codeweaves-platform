-- Chat-start privacy notice gets its own permission and add-on role (ADR-0004).
--
-- The notice is the client's legal wording and policy link. It lives in the
-- same widget-theme JSONB as appearance and branding, so AgentTheme:Update
-- alone would let anyone who styles the widget change or switch off the
-- notice. Same pattern as branding (20260810000000_split_agent_editor_roles):
-- a section-level permission, enforced field by field in AgentThemesService.
--
-- Order matters: the permission is org-allowed BEFORE any org role references
-- it, or the role-purity trigger rejects the insert.

INSERT INTO "permissions" ("key", "resource", "action", "description", "org_allowed") VALUES
  ('AgentTheme:UpdateConsent', 'AgentTheme', 'UpdateConsent', 'Change the chat privacy notice and consent settings', true)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "roles" ("key", "name", "description", "org_allowed", "client_grantable") VALUES
  ('org.agent_privacy', 'Agent Privacy Notice', 'Change the chat privacy notice, policy link and consent mode', true, true)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_key", "permission_key") VALUES
  -- Agent:Read so the section can load the agent, AgentTheme:Read for the theme.
  ('org.agent_privacy', 'Agent:Read'),
  ('org.agent_privacy', 'AgentTheme:Read'),
  ('org.agent_privacy', 'AgentTheme:UpdateConsent'),

  -- Unlike branding, the notice is the owner's own legal duty (they are the
  -- data fiduciary), so every org owner holds it by default.
  ('org.owner', 'AgentTheme:UpdateConsent'),

  -- Platform staff who administer agents.
  ('platform.agent_admin', 'AgentTheme:UpdateConsent')
ON CONFLICT DO NOTHING;

-- Super admin holds every permission.
INSERT INTO "role_permissions" ("role_key", "permission_key")
SELECT 'platform.super_admin', "key" FROM "permissions"
ON CONFLICT DO NOTHING;
