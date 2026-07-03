-- CreateEnum
CREATE TYPE "HandoverState" AS ENUM ('NONE', 'REQUESTED', 'ACTIVE_HUMAN');

-- CreateEnum
CREATE TYPE "HandoverReason" AS ENUM ('USER_REQUESTED', 'BOT_FALLBACK', 'FRUSTRATION', 'MANUAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MessageRole" ADD VALUE 'HUMAN_AGENT';
ALTER TYPE "MessageRole" ADD VALUE 'SYSTEM';

-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "humanConnectedLabel" VARCHAR(160),
ADD COLUMN     "humanTakeoverEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "showTalkToHumanButton" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "handoverReason" "HandoverReason",
ADD COLUMN     "handoverRequestedAt" TIMESTAMP(3),
ADD COLUMN     "handoverResolvedAt" TIMESTAMP(3),
ADD COLUMN     "handoverStartedAt" TIMESTAMP(3),
ADD COLUMN     "handoverState" "HandoverState" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "takenOverById" TEXT;

-- CreateIndex
CREATE INDEX "chat_sessions_agentId_handoverState_idx" ON "chat_sessions"("agentId", "handoverState");

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_takenOverById_fkey" FOREIGN KEY ("takenOverById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
