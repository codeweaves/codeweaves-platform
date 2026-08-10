-- Correct two role descriptions that no longer match what the roles grant.
--
-- These strings are not documentation: `GET /rbac/roles` serves them, and both
-- the invite dialog and the edit-roles dialog render them next to each checkbox.
-- A stale one actively misleads whoever is assigning the role.
--
--   org.agent_editor  still advertised the prompt and knowledge base, which moved
--                     out to org.agent_prompt in 20260810000000.
--   org.owner         still said "full control", which stopped being true once
--                     team access and branding were removed.
UPDATE "roles"
SET "description" = 'Edit appearance, chat interface, behaviour, voice and classification'
WHERE "key" = 'org.agent_editor';

UPDATE "roles"
SET "description" = 'Manage this organization''s agents, conversations and analytics'
WHERE "key" = 'org.owner';
