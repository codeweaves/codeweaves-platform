-- ADR-0012: seed the price list, then copy llm_usage into usage_records.
--
-- Prices are the public pay-as-you-go list prices retrieved 2026-10-10
-- (docs/research/provider-costs/). Every account was on a free trial, so there
-- were no negotiated rates. They are made effective from 2026-01-01 so the
-- backfill below can price older calls; the note on each row says so. A price
-- change adds a new row with a later effectiveFrom; rows are never edited.

INSERT INTO "provider_prices" ("id", "provider", "model", "unit", "price", "per", "currency", "effectiveFrom", "sourceUrl", "note") VALUES
  -- OpenAI, USD per 1M tokens. Cached input on the 4.1 models is 25% of input.
  (gen_random_uuid(), 'openai', 'gpt-4.1',      'INPUT_TOKEN',        2.00,  1000000, 'USD', '2026-01-01', 'https://developers.openai.com/api/docs/pricing', 'List price retrieved 2026-10-10'),
  (gen_random_uuid(), 'openai', 'gpt-4.1',      'CACHED_INPUT_TOKEN', 0.50,  1000000, 'USD', '2026-01-01', 'https://developers.openai.com/api/docs/pricing', 'List price retrieved 2026-10-10'),
  (gen_random_uuid(), 'openai', 'gpt-4.1',      'OUTPUT_TOKEN',       8.00,  1000000, 'USD', '2026-01-01', 'https://developers.openai.com/api/docs/pricing', 'List price retrieved 2026-10-10'),
  (gen_random_uuid(), 'openai', 'gpt-4.1-mini', 'INPUT_TOKEN',        0.40,  1000000, 'USD', '2026-01-01', 'https://developers.openai.com/api/docs/pricing', 'List price retrieved 2026-10-10'),
  (gen_random_uuid(), 'openai', 'gpt-4.1-mini', 'CACHED_INPUT_TOKEN', 0.10,  1000000, 'USD', '2026-01-01', 'https://developers.openai.com/api/docs/pricing', 'List price retrieved 2026-10-10'),
  (gen_random_uuid(), 'openai', 'gpt-4.1-mini', 'OUTPUT_TOKEN',       1.60,  1000000, 'USD', '2026-01-01', 'https://developers.openai.com/api/docs/pricing', 'List price retrieved 2026-10-10'),
  (gen_random_uuid(), 'openai', 'gpt-4o-mini',  'INPUT_TOKEN',        0.15,  1000000, 'USD', '2026-01-01', 'https://developers.openai.com/api/docs/pricing', 'List price retrieved 2026-10-10'),
  (gen_random_uuid(), 'openai', 'gpt-4o-mini',  'CACHED_INPUT_TOKEN', 0.075, 1000000, 'USD', '2026-01-01', 'https://developers.openai.com/api/docs/pricing', 'List price retrieved 2026-10-10'),
  (gen_random_uuid(), 'openai', 'gpt-4o-mini',  'OUTPUT_TOKEN',       0.60,  1000000, 'USD', '2026-01-01', 'https://developers.openai.com/api/docs/pricing', 'List price retrieved 2026-10-10'),

  -- Gemini, USD per 1M tokens, paid tier Standard. Output includes thinking tokens.
  (gen_random_uuid(), 'gemini', 'gemini-2.5-flash',      'INPUT_TOKEN',        0.30, 1000000, 'USD', '2026-01-01', 'https://ai.google.dev/gemini-api/docs/pricing', 'List price retrieved 2026-10-10'),
  (gen_random_uuid(), 'gemini', 'gemini-2.5-flash',      'CACHED_INPUT_TOKEN', 0.03, 1000000, 'USD', '2026-01-01', 'https://ai.google.dev/gemini-api/docs/pricing', 'List price retrieved 2026-10-10'),
  (gen_random_uuid(), 'gemini', 'gemini-2.5-flash',      'OUTPUT_TOKEN',       2.50, 1000000, 'USD', '2026-01-01', 'https://ai.google.dev/gemini-api/docs/pricing', 'List price retrieved 2026-10-10'),
  (gen_random_uuid(), 'gemini', 'gemini-2.5-flash-lite', 'INPUT_TOKEN',        0.10, 1000000, 'USD', '2026-01-01', 'https://ai.google.dev/gemini-api/docs/pricing', 'List price retrieved 2026-10-10'),
  (gen_random_uuid(), 'gemini', 'gemini-2.5-flash-lite', 'CACHED_INPUT_TOKEN', 0.01, 1000000, 'USD', '2026-01-01', 'https://ai.google.dev/gemini-api/docs/pricing', 'List price retrieved 2026-10-10'),
  (gen_random_uuid(), 'gemini', 'gemini-2.5-flash-lite', 'OUTPUT_TOKEN',       0.40, 1000000, 'USD', '2026-01-01', 'https://ai.google.dev/gemini-api/docs/pricing', 'List price retrieved 2026-10-10'),

  -- Sarvam chat, INR per 1M tokens. GST on top is unconfirmed.
  (gen_random_uuid(), 'sarvam', 'sarvam-105b', 'INPUT_TOKEN',        29.28, 1000000, 'INR', '2026-01-01', 'https://www.sarvam.ai/api-pricing', 'List price retrieved 2026-10-10; GST unconfirmed'),
  (gen_random_uuid(), 'sarvam', 'sarvam-105b', 'CACHED_INPUT_TOKEN', 10.98, 1000000, 'INR', '2026-01-01', 'https://www.sarvam.ai/api-pricing', 'List price retrieved 2026-10-10; GST unconfirmed'),
  (gen_random_uuid(), 'sarvam', 'sarvam-105b', 'OUTPUT_TOKEN',       73.20, 1000000, 'INR', '2026-01-01', 'https://www.sarvam.ai/api-pricing', 'List price retrieved 2026-10-10; GST unconfirmed'),

  -- Speech-to-text, per audio second.
  (gen_random_uuid(), 'sarvam',     'saaras:v3',    'AUDIO_SECOND', 30.00,  3600, 'INR', '2026-01-01', 'https://www.sarvam.ai/api-pricing', 'Rs 30/hour, billed per second rounded up, min 1 s. The FAQ +10% language-detection surcharge is unconfirmed and not applied'),
  (gen_random_uuid(), 'sarvam',     'saarika:v2.5', 'AUDIO_SECOND', 30.00,  3600, 'INR', '2026-01-01', 'https://www.sarvam.ai/api-pricing', 'Same "Speech to Text" rate assumed; the page names no model'),
  (gen_random_uuid(), 'deepgram',   'nova-3',       'AUDIO_SECOND', 0.0043, 60,   'USD', '2026-01-01', 'https://deepgram.com/pricing', 'Nova-3 monolingual pre-recorded, pay-as-you-go $0.0043/min'),
  (gen_random_uuid(), 'elevenlabs', 'scribe_v2',    'AUDIO_SECOND', 0.22,   3600, 'USD', '2026-01-01', 'https://elevenlabs.io/pricing/api', 'Scribe v2 batch $0.22/hour'),

  -- Text-to-speech, per character.
  (gen_random_uuid(), 'sarvam',     'bulbul:v3',         'CHARACTER', 30.00, 10000, 'INR', '2026-01-01', 'https://www.sarvam.ai/api-pricing', 'Rs 30 per 10K characters, REST and streaming'),
  (gen_random_uuid(), 'elevenlabs', 'eleven_turbo_v2_5', 'CHARACTER', 0.04,  1000,  'USD', '2026-01-01', 'https://elevenlabs.io/pricing/api', 'Flash/Turbo $0.04 per 1K characters (USD API pricing)');

-- Backfill: one usage_records row per llm_usage row.
-- - Old ids are 'provider:model' or a bare OpenRouter 'vendor/model' id.
-- - Cost is recomputed from the prices above:
--     (input - cached) x input + cached x cached-input + output x output.
-- - OpenRouter rows keep the cost OpenRouter reported, which was the only
--   cost ever stored.
-- - Removed or unpriced models (groq:, cerebras:, embeddings) keep their token
--   counts with cost = null, so they show up as unpriced.
-- - Warmup calls (since removed) are filed under CHAT.
-- - llm_usage stored the public session id; it is resolved to the internal one.
WITH src AS (
  SELECT
    u.*,
    CASE WHEN position(':' IN u."model") > 0 AND position('/' IN split_part(u."model", ':', 1)) = 0
      THEN lower(split_part(u."model", ':', 1)) ELSE 'openrouter' END AS prov,
    CASE WHEN position(':' IN u."model") > 0 AND position('/' IN split_part(u."model", ':', 1)) = 0
      THEN substr(u."model", position(':' IN u."model") + 1) ELSE u."model" END AS mdl,
    s."id" AS chat_session_id,
    s."source" AS session_source
  FROM "llm_usage" u
  LEFT JOIN "chat_sessions" s ON s."sessionId" = u."sessionId"
)
INSERT INTO "usage_records" (
  "id", "occurredAt", "organizationId", "agentId", "chatSessionId", "messageId", "traceId",
  "channel", "feature", "provider", "model",
  "inputTokens", "cachedInputTokens", "outputTokens", "reasoningTokens",
  "cost", "currency", "pricing", "quantitySource", "billedTo", "latencyMs"
)
SELECT
  gen_random_uuid(),
  src."createdAt",
  o."id",
  a."id",
  src.chat_session_id,
  src."messageId",
  src."traceId",
  CASE
    WHEN src."feature" IN ('summarization', 'title-generation', 'rag-contextual', 'rag-evaluation', 'embedding') THEN 'INTERNAL'
    WHEN src.session_source = 'WHATSAPP' THEN 'WHATSAPP'
    WHEN src."feature" = 'voice' THEN 'VOICE'
    ELSE 'WIDGET'
  END::"EventChannel",
  CASE src."feature"
    WHEN 'summarization' THEN 'SUMMARY'
    WHEN 'title-generation' THEN 'TITLE'
    WHEN 'rag-query' THEN 'RAG'
    WHEN 'rag-contextual' THEN 'RAG'
    WHEN 'rag-evaluation' THEN 'RAG'
    WHEN 'embedding' THEN 'EMBEDDING'
    ELSE 'CHAT'
  END::"UsageFeature",
  src.prov,
  src.mdl,
  src."promptTokens",
  COALESCE(src."cachedInputTokens", 0),
  src."completionTokens",
  src."reasoningTokens",
  CASE
    WHEN src.prov = 'openrouter' THEN src."cost"::numeric
    WHEN pin."price" IS NULL OR pcached."price" IS NULL OR pout."price" IS NULL THEN NULL
    ELSE round(
        GREATEST(src."promptTokens" - COALESCE(src."cachedInputTokens", 0), 0) * pin."price" / pin."per"
      + COALESCE(src."cachedInputTokens", 0) * pcached."price" / pcached."per"
      + src."completionTokens" * pout."price" / pout."per", 8)
  END,
  CASE
    WHEN src.prov = 'openrouter' AND src."cost" IS NOT NULL THEN 'USD'::"Currency"
    ELSE pin."currency"
  END,
  -- Same shape as live rows: [{unit, quantity, priceId, price, per, amount}],
  -- one line per billed unit. OpenRouter rows carry only their reported cost.
  CASE WHEN src.prov = 'openrouter' THEN '[]'::jsonb ELSE COALESCE((
    SELECT jsonb_agg(line.l ORDER BY line.ord) FROM (
      SELECT 1 AS ord, jsonb_build_object(
        'unit', 'INPUT_TOKEN',
        'quantity', GREATEST(src."promptTokens" - COALESCE(src."cachedInputTokens", 0), 0),
        'priceId', pin."id", 'price', pin."price", 'per', pin."per",
        'amount', round(GREATEST(src."promptTokens" - COALESCE(src."cachedInputTokens", 0), 0) * pin."price" / pin."per", 8)
      ) AS l
      WHERE GREATEST(src."promptTokens" - COALESCE(src."cachedInputTokens", 0), 0) > 0
      UNION ALL
      SELECT 2, jsonb_build_object(
        'unit', 'CACHED_INPUT_TOKEN',
        'quantity', COALESCE(src."cachedInputTokens", 0),
        'priceId', pcached."id", 'price', pcached."price", 'per', pcached."per",
        'amount', round(COALESCE(src."cachedInputTokens", 0) * pcached."price" / pcached."per", 8)
      )
      WHERE COALESCE(src."cachedInputTokens", 0) > 0
      UNION ALL
      SELECT 3, jsonb_build_object(
        'unit', 'OUTPUT_TOKEN',
        'quantity', src."completionTokens",
        'priceId', pout."id", 'price', pout."price", 'per', pout."per",
        'amount', round(src."completionTokens" * pout."price" / pout."per", 8)
      )
      WHERE src."completionTokens" > 0
    ) line
  ), '[]'::jsonb) END,
  'PROVIDER_REPORTED'::"QuantitySource",
  'PLATFORM'::"BilledTo",
  src."latencyMs"
FROM src
-- Keep the row even when its org or agent was hard-deleted; drop the dangling link.
LEFT JOIN "organizations" o ON o."id" = src."organizationId"
LEFT JOIN "agents" a ON a."id" = src."agentId"
LEFT JOIN LATERAL (
  SELECT p.* FROM "provider_prices" p
  WHERE p."provider" = src.prov AND p."model" = src.mdl AND p."unit" = 'INPUT_TOKEN' AND p."effectiveFrom" <= src."createdAt"
  ORDER BY p."effectiveFrom" DESC LIMIT 1
) pin ON true
LEFT JOIN LATERAL (
  SELECT p.* FROM "provider_prices" p
  WHERE p."provider" = src.prov AND p."model" = src.mdl AND p."unit" = 'CACHED_INPUT_TOKEN' AND p."effectiveFrom" <= src."createdAt"
  ORDER BY p."effectiveFrom" DESC LIMIT 1
) pcached ON true
LEFT JOIN LATERAL (
  SELECT p.* FROM "provider_prices" p
  WHERE p."provider" = src.prov AND p."model" = src.mdl AND p."unit" = 'OUTPUT_TOKEN' AND p."effectiveFrom" <= src."createdAt"
  ORDER BY p."effectiveFrom" DESC LIMIT 1
) pout ON true;
