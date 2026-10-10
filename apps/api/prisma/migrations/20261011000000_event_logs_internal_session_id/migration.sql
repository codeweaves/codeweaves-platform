-- event_logs.sessionId now holds the internal ChatSession.id. Older rows hold
-- the public widget session id, which is a bearer credential and must not sit
-- in a log. Data only: no schema change.

-- 1. Public session id -> internal conversation id.
UPDATE "event_logs" AS e
SET "sessionId" = cs."id"
FROM "chat_sessions" AS cs
WHERE e."sessionId" = cs."sessionId";

-- 2. Anything that matches no conversation (e.g. pre-session "warmup" calls)
--    cannot be linked and may be a credential: clear it.
UPDATE "event_logs" AS e
SET "sessionId" = NULL
WHERE e."sessionId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "chat_sessions" AS cs WHERE cs."id" = e."sessionId");
