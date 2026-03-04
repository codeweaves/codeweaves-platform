-- AlterEnum
ALTER TYPE "ChatSource" ADD VALUE 'WHATSAPP';

-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "visitorId" TEXT;

-- CreateIndex
CREATE INDEX "chat_sessions_visitorId_idx" ON "chat_sessions"("visitorId");
