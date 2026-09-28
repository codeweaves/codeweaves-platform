-- Tenant key on message rows, release 2 of 2: contract (ADR-0007).
--
-- Release 1 added the copied keys as nullable and every writer now sets them.
-- This fills the rows the previous code wrote while release 1 was deploying,
-- makes the keys required, and replaces the session foreign key with one over
-- (chatSessionId, agentId, sessionSource), so a message's copied keys must
-- match its session.

-- Take every lock this migration needs up front, in the order a session
-- delete takes them (session, then its messages, then their metrics). Taking
-- them statement by statement would lock chat_messages before chat_sessions,
-- the reverse of an erasure running at the same moment, and deadlock with it.
LOCK TABLE "chat_sessions" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "chat_messages" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "chat_message_metrics" IN ACCESS EXCLUSIVE MODE;

-- Backfill every row whose copies are missing or disagree with the source of
-- truth, so the constraints below cannot fail on an existing row.
UPDATE "chat_messages" m
SET "agentId" = s."agentId",
    "sessionSource" = s."source"
FROM "chat_sessions" s
WHERE s."id" = m."chatSessionId"
  AND (m."agentId" IS DISTINCT FROM s."agentId" OR m."sessionSource" IS DISTINCT FROM s."source");

UPDATE "chat_message_metrics" mm
SET "agentId" = m."agentId",
    "sessionSource" = m."sessionSource",
    "role" = m."role"
FROM "chat_messages" m
WHERE m."id" = mm."messageId"
  AND (
    mm."agentId" IS DISTINCT FROM m."agentId"
    OR mm."sessionSource" IS DISTINCT FROM m."sessionSource"
    OR mm."role" IS DISTINCT FROM m."role"
  );

-- AlterTable
ALTER TABLE "chat_messages" ALTER COLUMN "agentId" SET NOT NULL,
ALTER COLUMN "sessionSource" SET NOT NULL;

-- AlterTable
ALTER TABLE "chat_message_metrics" ALTER COLUMN "agentId" SET NOT NULL,
ALTER COLUMN "sessionSource" SET NOT NULL,
ALTER COLUMN "role" SET NOT NULL;

-- DropForeignKey
ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_chatSessionId_fkey";

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_chatSessionId_agentId_sessionSource_fkey" FOREIGN KEY ("chatSessionId", "agentId", "sessionSource") REFERENCES "chat_sessions"("id", "agentId", "source") ON DELETE CASCADE ON UPDATE CASCADE;
