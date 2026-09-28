-- Tenant key on message rows, release 1 of 2: expand (ADR-0007).
--
-- Copies the session's agentId and source onto chat_messages, and agentId,
-- source and role onto chat_message_metrics, so analytics can filter each
-- table by (agentId, createdAt), and by channel, instead of scanning every
-- tenant's rows and joining up to the session. The copied source is named
-- "sessionSource" so SQL that joins a session to its messages can keep using
-- an unqualified "source".
--
-- The columns stay nullable here: the code running while this migration
-- applies does not write them yet. Release 2 backfills the rows that code
-- wrote in the meantime, sets NOT NULL, and swaps in the composite
-- (chatSessionId, agentId, sessionSource) foreign key that the unique index
-- below prepares.

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN "agentId" TEXT,
ADD COLUMN "sessionSource" "ChatSource";

-- AlterTable
ALTER TABLE "chat_message_metrics" ADD COLUMN "agentId" TEXT,
ADD COLUMN "sessionSource" "ChatSource",
ADD COLUMN "role" "MessageRole";

-- Backfill
UPDATE "chat_messages" m
SET "agentId" = s."agentId",
    "sessionSource" = s."source"
FROM "chat_sessions" s
WHERE s."id" = m."chatSessionId";

UPDATE "chat_message_metrics" mm
SET "agentId" = m."agentId",
    "sessionSource" = m."sessionSource",
    "role" = m."role"
FROM "chat_messages" m
WHERE m."id" = mm."messageId";

-- CreateIndex
CREATE UNIQUE INDEX "chat_sessions_id_agentId_source_key" ON "chat_sessions"("id", "agentId", "source");

-- CreateIndex
CREATE INDEX "chat_sessions_agentId_createdAt_idx" ON "chat_sessions"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_messages_agentId_createdAt_idx" ON "chat_messages"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_message_metrics_agentId_createdAt_idx" ON "chat_message_metrics"("agentId", "createdAt");

-- DropIndex: covered by chat_sessions_agentId_createdAt_idx (same leading column).
DROP INDEX "chat_sessions_agentId_idx";

-- DropIndex: covered by chat_messages_chatSessionId_role_idx (same leading column).
DROP INDEX "chat_messages_chatSessionId_idx";

-- DropIndex: every time-range query now leads with agentId.
DROP INDEX "chat_messages_createdAt_idx";

-- DropIndex: every time-range query now leads with agentId.
DROP INDEX "chat_message_metrics_createdAt_idx";
