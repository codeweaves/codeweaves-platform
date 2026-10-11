-- Retire n8n chat routing (ADR-0014). Every agent is served by the direct LLM path.

-- 1. n8n webhook URLs and the HMAC secrets used to verify n8n responses.
--    Nothing reads them any more.
DROP TABLE IF EXISTS "agent_secrets";

-- 2. The per-agent switch for HMAC-verifying n8n responses.
ALTER TABLE "agents" DROP COLUMN IF EXISTS "hmacEnabled";

-- 3. The n8n/direct routing switch inside aiConfig. The API still accepts the key
--    so older payloads validate, but ignores it; strip it so stored configs carry
--    only settings that mean something.
UPDATE "agents"
SET "aiConfig" = "aiConfig" - 'routingMode'
WHERE "aiConfig" ? 'routingMode';
