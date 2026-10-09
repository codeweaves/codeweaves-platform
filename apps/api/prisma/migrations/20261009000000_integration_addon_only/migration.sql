-- Integration is an add-on (org.agent_integrations), not part of the owner
-- package. See ADR-0010.
--
-- 1. 20260810000000 gave org.owner Agent:UpdateIntegration, but the Integration
--    tab needs AgentSecret:Read, which only the add-on holds. Owners could not
--    see the tab yet could change routing and the AI model through the API.
--    Remove the grant so the owner role matches the add-on design.
DELETE FROM "role_permissions"
WHERE "role_key" = 'org.owner' AND "permission_key" = 'Agent:UpdateIntegration';

-- 2. Allowed domains (the widget's embed allow-list) are now read and written
--    with Agent:UpdateIntegration. These strings are served by GET /rbac/roles
--    and shown next to each checkbox in the invite and edit-roles dialogs, so
--    whoever grants the add-on must see that it controls where the widget loads.
UPDATE "permissions"
SET "description" = 'Change allowed domains, routing and AI model'
WHERE "key" = 'Agent:UpdateIntegration';

UPDATE "roles"
SET "description" = 'Manage allowed domains, routing and the webhook secret'
WHERE "key" = 'org.agent_integrations';
