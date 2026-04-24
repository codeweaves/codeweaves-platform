-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "aiConfig" JSONB;

-- CreateTable
CREATE TABLE "chat_traces" (
    "id" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "correlationId" TEXT,
    "agentId" TEXT NOT NULL,
    "sessionId" TEXT,
    "messageId" TEXT,
    "userMessage" TEXT,
    "response" TEXT,
    "model" TEXT,
    "steps" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "totalDurationMs" INTEGER,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_traces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_usage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "sessionId" TEXT,
    "messageId" TEXT,
    "traceId" TEXT,
    "model" TEXT NOT NULL,
    "requestedModel" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "cost" DOUBLE PRECISION,
    "feature" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "finishReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_traces_traceId_key" ON "chat_traces"("traceId");

-- CreateIndex
CREATE INDEX "chat_traces_agentId_createdAt_idx" ON "chat_traces"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_traces_sessionId_idx" ON "chat_traces"("sessionId");

-- CreateIndex
CREATE INDEX "chat_traces_correlationId_idx" ON "chat_traces"("correlationId");

-- CreateIndex
CREATE INDEX "chat_traces_traceId_idx" ON "chat_traces"("traceId");

-- CreateIndex
CREATE INDEX "llm_usage_organizationId_createdAt_idx" ON "llm_usage"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "llm_usage_agentId_createdAt_idx" ON "llm_usage"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "llm_usage_feature_idx" ON "llm_usage"("feature");

-- CreateIndex
CREATE INDEX "llm_usage_traceId_idx" ON "llm_usage"("traceId");
