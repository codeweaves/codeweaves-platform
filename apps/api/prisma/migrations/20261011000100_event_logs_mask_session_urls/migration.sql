-- Stored request URLs can carry the public widget session id (a bearer
-- credential) in the path (/public/chat/:id/poll, /conversations/:id,
-- /handover/:id/...) or in a sessionId query param. Keep only its first 8
-- characters, the same as the API now does when it logs a URL. Data only.

UPDATE "event_logs"
SET "requestUrl" = regexp_replace(
  "requestUrl",
  '(/(public/chat|conversations|handover|dev/ai/sessions)/)([A-Za-z0-9_-]{8})[A-Za-z0-9_-]{8,}',
  '\1\3…',
  'g'
)
WHERE "requestUrl" ~ '/(public/chat|conversations|handover|dev/ai/sessions)/[A-Za-z0-9_-]{16,}';

UPDATE "event_logs"
SET "requestUrl" = regexp_replace(
  "requestUrl",
  '([?&](sessionId|session|publicSessionId)=)([^&#]{8})[^&#]+',
  '\1\3…',
  'gi'
)
WHERE "requestUrl" ~* '[?&](sessionId|session|publicSessionId)=[^&#]{9,}';
