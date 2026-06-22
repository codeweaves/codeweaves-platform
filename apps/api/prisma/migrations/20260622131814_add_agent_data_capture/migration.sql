-- CreateEnum
CREATE TYPE "DataFieldType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'DATE', 'EMAIL', 'PHONE');

-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "extractionDueAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "agent_data_fields" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "type" "DataFieldType" NOT NULL DEFAULT 'STRING',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_data_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collected_data" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "chatSessionId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collected_data_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_data_fields_agentId_idx" ON "agent_data_fields"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_data_fields_agentId_key_key" ON "agent_data_fields"("agentId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "collected_data_chatSessionId_key" ON "collected_data"("chatSessionId");

-- CreateIndex
CREATE INDEX "collected_data_agentId_idx" ON "collected_data"("agentId");

-- CreateIndex
CREATE INDEX "chat_sessions_extractionDueAt_idx" ON "chat_sessions"("extractionDueAt");

-- AddForeignKey
ALTER TABLE "agent_data_fields" ADD CONSTRAINT "agent_data_fields_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collected_data" ADD CONSTRAINT "collected_data_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collected_data" ADD CONSTRAINT "collected_data_chatSessionId_fkey" FOREIGN KEY ("chatSessionId") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
