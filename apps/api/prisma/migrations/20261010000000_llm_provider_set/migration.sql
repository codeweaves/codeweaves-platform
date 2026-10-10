-- ADR-0011: the supported LLM providers are OpenAI, Gemini and Sarvam.
-- Groq, Cerebras and OpenRouter are removed, and with them
-- `aiConfig.fallbackModels`, which only OpenRouter supported.
--
-- After this deploy:
-- - The API rejects any modelId without an openai:, gemini: or sarvam: prefix.
-- - agentAiConfigSchema is .strict(), so a stored config that still carries
--   fallbackModels would fail validation on its next edit.
--
-- So every stored agent is moved first:
--   modelId on a removed provider -> 'openai:gpt-4.1-mini'
--   fallbackModels                -> removed
-- Each changed agent gets an audit row with its old and new values.

INSERT INTO "audit_logs" ("id", "contextId", "organizationId", "agentId", "event", "data", "createdAt")
SELECT
  gen_random_uuid(),
  a."id",
  a."organizationId",
  a."id",
  'AGENT_AI_CONFIG_MIGRATED',
  jsonb_build_object(
    'reason', 'ADR-0011: Groq, Cerebras and OpenRouter removed',
    'migration', '20261010000000_llm_provider_set',
    'oldModelId', a."aiConfig"->>'modelId',
    'newModelId', CASE
      WHEN a."aiConfig" ? 'modelId'
        AND (a."aiConfig"->>'modelId') !~* '^(openai|gemini|sarvam):'
      THEN 'openai:gpt-4.1-mini'
      ELSE a."aiConfig"->>'modelId'
    END,
    'removedFallbackModels', a."aiConfig"->'fallbackModels'
  ),
  now()
FROM "agents" a
WHERE a."aiConfig" IS NOT NULL
  AND (
    (a."aiConfig" ? 'modelId' AND (a."aiConfig"->>'modelId') !~* '^(openai|gemini|sarvam):')
    OR a."aiConfig" ? 'fallbackModels'
  );

UPDATE "agents"
SET "aiConfig" = ("aiConfig" - 'fallbackModels')
  || CASE
       WHEN "aiConfig" ? 'modelId'
         AND ("aiConfig"->>'modelId') !~* '^(openai|gemini|sarvam):'
       THEN jsonb_build_object('modelId', 'openai:gpt-4.1-mini')
       ELSE '{}'::jsonb
     END
WHERE "aiConfig" IS NOT NULL
  AND (
    ("aiConfig" ? 'modelId' AND ("aiConfig"->>'modelId') !~* '^(openai|gemini|sarvam):')
    OR "aiConfig" ? 'fallbackModels'
  );
