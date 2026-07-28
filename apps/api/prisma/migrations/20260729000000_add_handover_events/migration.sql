-- Human-handover history: ONE row per handover REQUEST (append-only), so
-- analytics reflect every handover instead of only a chat's latest cycle.
-- The chat_sessions handover columns stay the live source of truth for the
-- Inbox + takeover/resolve state machine; this table is written ALONGSIDE them.
--
-- RLS: the auto_enable_rls trigger (migration 20260725000100) turns RLS on for
-- every new public table automatically. The explicit ALTER at the bottom is
-- belt-and-braces. RLS with no policy = deny-all to anon/authenticated; the app
-- connects with the service role and bypasses it.

-- CreateEnum
CREATE TYPE "HandoverResolution" AS ENUM ('HUMAN', 'AUTO_INACTIVE');

-- CreateTable
CREATE TABLE "handover_events" (
    "id" TEXT NOT NULL,
    "chatSessionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "reason" "HandoverReason" NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolution" "HandoverResolution",
    "takenOverById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "handover_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "handover_events_chatSessionId_resolvedAt_idx" ON "handover_events"("chatSessionId", "resolvedAt");
CREATE INDEX "handover_events_organizationId_requestedAt_idx" ON "handover_events"("organizationId", "requestedAt");
CREATE INDEX "handover_events_agentId_requestedAt_idx" ON "handover_events"("agentId", "requestedAt");

-- AddForeignKey
ALTER TABLE "handover_events" ADD CONSTRAINT "handover_events_chatSessionId_fkey" FOREIGN KEY ("chatSessionId") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "handover_events" ADD CONSTRAINT "handover_events_takenOverById_fkey" FOREIGN KEY ("takenOverById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: capture the handover data currently on chat_sessions as one event
-- each. History overwritten by prior re-escalations is unrecoverable; this keeps
-- everything still present today. `resolution` is inferred for historical rows
-- (took-over -> HUMAN, never-took-over-but-resolved -> AUTO_INACTIVE).
INSERT INTO "handover_events" (
  "id", "chatSessionId", "organizationId", "agentId", "reason",
  "requestedAt", "startedAt", "resolvedAt", "resolution", "takenOverById",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  cs."id",
  a."organizationId",
  cs."agentId",
  COALESCE(cs."handoverReason", 'MANUAL'::"HandoverReason"),
  cs."handoverRequestedAt",
  cs."handoverStartedAt",
  cs."handoverResolvedAt",
  CASE
    WHEN cs."handoverResolvedAt" IS NULL THEN NULL
    WHEN cs."handoverStartedAt" IS NOT NULL THEN 'HUMAN'::"HandoverResolution"
    ELSE 'AUTO_INACTIVE'::"HandoverResolution"
  END,
  cs."takenOverById",
  COALESCE(cs."handoverRequestedAt", cs."createdAt"),
  now()
FROM "chat_sessions" cs
JOIN "agents" a ON a."id" = cs."agentId"
WHERE cs."handoverRequestedAt" IS NOT NULL;

-- RLS (belt-and-braces; app uses the service role and bypasses it)
ALTER TABLE "handover_events" ENABLE ROW LEVEL SECURITY;
