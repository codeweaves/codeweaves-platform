-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "hmacEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "chat_messages_chatSessionId_role_idx" ON "chat_messages"("chatSessionId", "role");
