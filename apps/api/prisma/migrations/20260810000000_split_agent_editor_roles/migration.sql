-- Split the agent editor into a base role plus one add-on role per sensitive
-- section, so a teammate can be given the prompt without also getting the
-- WhatsApp credentials.
--
--   org.agent_editor      general, appearance, chat interface, behaviour, voice,
--                         classification  (the everyday config)
--   org.agent_prompt      system prompt + knowledge base
--   org.agent_data_capture  data-capture field definitions
--   org.agent_integrations  routing + webhook secret
--   org.agent_whatsapp    WhatsApp channel
--   org.agent_branding    the "Powered by" footer
--   org.agent_handover    handover SETTINGS (working the inbox stays org.inbox_agent)
--
-- Statement order matters: the purity trigger rejects attaching a platform-only
-- permission to an org-allowed role, so permissions are opened to orgs BEFORE
-- any role_permissions rows reference them.

-- ---------------------------------------------------------------------------
-- 1. New section-level permissions
--
-- These exist because `PATCH /agents/:id` writes prompt, handover and core
-- config in ONE call, and appearance/chat/branding share ONE JSONB column. A
-- permission can gate a call; it cannot gate which keys within a value a caller
-- may set. So these are enforced field-by-field in the services, and these rows
-- are what those checks consult.
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("key", "resource", "action", "description", "org_allowed") VALUES
  ('Agent:UpdatePrompt',        'Agent',      'UpdatePrompt',   'Edit the system prompt',              true),
  ('Agent:UpdateHandover',      'Agent',      'UpdateHandover', 'Change human-handover settings',      true),
  ('AgentTheme:UpdateBranding', 'AgentTheme', 'UpdateBranding', 'Change the Powered by footer',        true),
  ('Agent:UpdateIntegration',   'Agent',      'UpdateIntegration', 'Change routing / AI orchestration', true)
ON CONFLICT ("key") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Open the integration-ish permissions to organizations
--
-- They were platform-only because a client had no way to be given them
-- selectively. Now they can, so the customer's own webhook and WhatsApp number
-- become theirs to manage if you grant the role.
-- ---------------------------------------------------------------------------

UPDATE "permissions" SET "org_allowed" = true
WHERE "key" IN (
  'AgentSecret:Read', 'AgentSecret:Update',
  'AgentDataField:Read', 'AgentDataField:Update',
  'WhatsappChannel:Read', 'WhatsappChannel:Create',
  'WhatsappChannel:Update', 'WhatsappChannel:Delete'
);

-- ---------------------------------------------------------------------------
-- 3. Retire org.integrations
--
-- It bundled secrets + WhatsApp + data capture behind one closed role. Those are
-- now three separate grantable roles. Assignments are cleared first because the
-- FK is ON DELETE RESTRICT.
-- ---------------------------------------------------------------------------

DELETE FROM "user_role_assignments" WHERE "role_key" = 'org.integrations';
DELETE FROM "roles" WHERE "key" = 'org.integrations';

-- ---------------------------------------------------------------------------
-- 4. The six add-on roles. All grantable by an org manager.
-- ---------------------------------------------------------------------------

INSERT INTO "roles" ("key", "name", "description", "org_allowed", "client_grantable") VALUES
  ('org.agent_prompt',       'Agent Prompt',       'Edit the system prompt and knowledge base', true, true),
  ('org.agent_data_capture', 'Agent Data Capture', 'Configure which fields to collect',         true, true),
  ('org.agent_integrations', 'Agent Integrations', 'Manage routing and the webhook secret',     true, true),
  ('org.agent_whatsapp',     'Agent WhatsApp',     'Connect and manage the WhatsApp channel',   true, true),
  ('org.agent_branding',     'Agent Branding',     'Change the Powered by footer',              true, true),
  ('org.agent_handover',     'Agent Handover',     'Change human-handover settings',            true, true)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_key", "permission_key") VALUES
  -- Each add-on carries Agent:Read so its section can load the agent at all.
  ('org.agent_prompt', 'Agent:Read'),
  ('org.agent_prompt', 'Agent:UpdatePrompt'),
  ('org.agent_prompt', 'AgentKnowledge:Read'),
  ('org.agent_prompt', 'AgentKnowledge:Update'),
  ('org.agent_prompt', 'AgentKnowledge:Delete'),
  ('org.agent_prompt', 'File:Create'),
  ('org.agent_prompt', 'File:Delete'),

  ('org.agent_data_capture', 'Agent:Read'),
  ('org.agent_data_capture', 'AgentDataField:Read'),
  ('org.agent_data_capture', 'AgentDataField:Update'),
  ('org.agent_data_capture', 'CollectedData:Read'),

  ('org.agent_integrations', 'Agent:Read'),
  ('org.agent_integrations', 'Agent:UpdateIntegration'),
  ('org.agent_integrations', 'AgentSecret:Read'),
  ('org.agent_integrations', 'AgentSecret:Update'),

  ('org.agent_whatsapp', 'Agent:Read'),
  ('org.agent_whatsapp', 'WhatsappChannel:Read'),
  ('org.agent_whatsapp', 'WhatsappChannel:Create'),
  ('org.agent_whatsapp', 'WhatsappChannel:Update'),
  ('org.agent_whatsapp', 'WhatsappChannel:Delete'),

  ('org.agent_branding', 'Agent:Read'),
  ('org.agent_branding', 'AgentTheme:Read'),
  ('org.agent_branding', 'AgentTheme:UpdateBranding'),

  ('org.agent_handover', 'Agent:Read'),
  ('org.agent_handover', 'Agent:UpdateHandover')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Narrow the base editor role
--
-- Prompt and knowledge move out to org.agent_prompt. What is left is the
-- everyday config: general, appearance, chat interface, behaviour, voice,
-- classification.
-- ---------------------------------------------------------------------------

DELETE FROM "role_permissions"
WHERE "role_key" = 'org.agent_editor'
  AND "permission_key" IN (
    'AgentKnowledge:Read', 'AgentKnowledge:Update', 'AgentKnowledge:Delete',
    'File:Create', 'File:Delete'
  );

-- Anyone who already held the base role keeps what they had, so this migration
-- does not quietly take the prompt away from an existing teammate.
INSERT INTO "user_role_assignments" ("id", "user_id", "role_key", "organization_id", "granted_by")
SELECT gen_random_uuid()::text, a."user_id", 'org.agent_prompt', a."organization_id", a."granted_by"
FROM "user_role_assignments" a
WHERE a."role_key" = 'org.agent_editor' AND a."deleted_at" IS NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. org.owner keeps full control, so it gains the new section permissions.
--
-- Branding is deliberately EXCLUDED: it is the white-label lever, so it stays
-- something you grant on purpose via org.agent_branding rather than something
-- every owner has by default.
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_key", "permission_key") VALUES
  ('org.owner', 'Agent:UpdatePrompt'),
  ('org.owner', 'Agent:UpdateHandover'),
  ('org.owner', 'Agent:UpdateIntegration')
ON CONFLICT DO NOTHING;

-- Platform staff who administer agents get everything new, branding included.
INSERT INTO "role_permissions" ("role_key", "permission_key") VALUES
  ('platform.agent_admin', 'Agent:UpdatePrompt'),
  ('platform.agent_admin', 'Agent:UpdateHandover'),
  ('platform.agent_admin', 'Agent:UpdateIntegration'),
  ('platform.agent_admin', 'AgentTheme:UpdateBranding'),
  ('platform.agent_admin', 'AgentTheme:Read'),
  ('platform.agent_admin', 'AgentTheme:Update')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_key", "permission_key")
SELECT 'platform.super_admin', "key" FROM "permissions"
ON CONFLICT DO NOTHING;
