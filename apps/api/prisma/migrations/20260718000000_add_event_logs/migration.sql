-- CreateEnum
CREATE TYPE "EventChannel" AS ENUM ('WIDGET', 'DASHBOARD', 'WHATSAPP', 'VOICE', 'INTERNAL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "EventDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL');

-- CreateTable
CREATE TABLE "event_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" "EventChannel" NOT NULL,
    "eventName" TEXT NOT NULL,
    "direction" "EventDirection" NOT NULL DEFAULT 'INTERNAL',
    "provider" TEXT,
    "actorUserId" TEXT,
    "clerkId" TEXT,
    "visitorId" TEXT,
    "agentId" TEXT,
    "organizationId" TEXT,
    "sessionId" TEXT,
    "correlationId" TEXT,
    "requestUrl" TEXT,
    "requestHeaders" JSONB,
    "requestPayload" JSONB,
    "responseStatus" INTEGER,
    "responsePayload" JSONB,
    "latencyMs" INTEGER,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "metadata" JSONB,

    CONSTRAINT "event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_logs_channel_createdAt_idx" ON "event_logs"("channel", "createdAt");

-- CreateIndex
CREATE INDEX "event_logs_agentId_createdAt_idx" ON "event_logs"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "event_logs_organizationId_createdAt_idx" ON "event_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "event_logs_sessionId_idx" ON "event_logs"("sessionId");

-- CreateIndex
CREATE INDEX "event_logs_correlationId_idx" ON "event_logs"("correlationId");

-- CreateIndex
CREATE INDEX "event_logs_eventName_idx" ON "event_logs"("eventName");

-- CreateIndex
CREATE INDEX "event_logs_provider_idx" ON "event_logs"("provider");

-- CreateIndex
CREATE INDEX "event_logs_actorUserId_idx" ON "event_logs"("actorUserId");
