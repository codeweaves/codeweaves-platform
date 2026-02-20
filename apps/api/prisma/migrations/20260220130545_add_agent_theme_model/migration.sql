-- CreateTable
CREATE TABLE "agent_themes" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_themes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_themes_agentId_key" ON "agent_themes"("agentId");

-- CreateIndex
CREATE INDEX "agent_themes_agentId_idx" ON "agent_themes"("agentId");

-- AddForeignKey
ALTER TABLE "agent_themes" ADD CONSTRAINT "agent_themes_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
