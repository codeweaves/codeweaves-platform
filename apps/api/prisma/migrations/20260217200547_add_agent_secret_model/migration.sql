-- CreateTable
CREATE TABLE "agent_secrets" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "apiKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_secrets_agentId_key" ON "agent_secrets"("agentId");

-- CreateIndex
CREATE INDEX "agent_secrets_agentId_idx" ON "agent_secrets"("agentId");

-- AddForeignKey
ALTER TABLE "agent_secrets" ADD CONSTRAINT "agent_secrets_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
