-- CreateEnum
CREATE TYPE "PriceUnit" AS ENUM ('INPUT_TOKEN', 'CACHED_INPUT_TOKEN', 'CACHE_WRITE_TOKEN', 'OUTPUT_TOKEN', 'AUDIO_SECOND', 'CHARACTER', 'MESSAGE', 'EMAIL');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('USD', 'INR');

-- CreateEnum
CREATE TYPE "UsageFeature" AS ENUM ('CHAT', 'SUMMARY', 'TITLE', 'CLASSIFIER', 'DATA_EXTRACTION', 'RAG', 'EMBEDDING', 'STT', 'TTS', 'VOICE_PREVIEW', 'WHATSAPP_MESSAGE', 'EMAIL');

-- CreateEnum
CREATE TYPE "QuantitySource" AS ENUM ('PROVIDER_REPORTED', 'MEASURED', 'ESTIMATED');

-- CreateEnum
CREATE TYPE "BilledTo" AS ENUM ('PLATFORM', 'CLIENT');

-- CreateTable
CREATE TABLE "provider_prices" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "unit" "PriceUnit" NOT NULL,
    "price" DECIMAL(18,8) NOT NULL,
    "per" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT,
    "agentId" TEXT,
    "chatSessionId" TEXT,
    "messageId" TEXT,
    "traceId" TEXT,
    "channel" "EventChannel" NOT NULL,
    "feature" "UsageFeature" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "providerRequestId" TEXT,
    "inputTokens" INTEGER,
    "cachedInputTokens" INTEGER,
    "cacheWriteTokens" INTEGER,
    "outputTokens" INTEGER,
    "reasoningTokens" INTEGER,
    "audioSeconds" DECIMAL(12,3),
    "characters" INTEGER,
    "units" INTEGER,
    "cost" DECIMAL(18,8),
    "currency" "Currency",
    "pricing" JSONB,
    "quantitySource" "QuantitySource" NOT NULL,
    "billedTo" "BilledTo" NOT NULL DEFAULT 'PLATFORM',
    "latencyMs" INTEGER,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "date" DATE NOT NULL,
    "usdToInr" DECIMAL(12,6) NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE INDEX "provider_prices_provider_model_idx" ON "provider_prices"("provider", "model");

-- CreateIndex
CREATE UNIQUE INDEX "provider_prices_provider_model_unit_effectiveFrom_key" ON "provider_prices"("provider", "model", "unit", "effectiveFrom");

-- CreateIndex
CREATE INDEX "usage_records_organizationId_occurredAt_idx" ON "usage_records"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "usage_records_agentId_occurredAt_idx" ON "usage_records"("agentId", "occurredAt");

-- CreateIndex
CREATE INDEX "usage_records_chatSessionId_idx" ON "usage_records"("chatSessionId");

-- CreateIndex
CREATE INDEX "usage_records_provider_model_occurredAt_idx" ON "usage_records"("provider", "model", "occurredAt");

-- CreateIndex
CREATE INDEX "usage_records_occurredAt_idx" ON "usage_records"("occurredAt");

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_chatSessionId_fkey" FOREIGN KEY ("chatSessionId") REFERENCES "chat_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
