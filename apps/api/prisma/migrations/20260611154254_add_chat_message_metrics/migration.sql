-- CreateTable
CREATE TABLE "chat_message_metrics" (
    "messageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "inputType" TEXT,
    "streamed" BOOLEAN,
    "responseLatencyMs" INTEGER,
    "llmLatencyMs" INTEGER,
    "timeToFirstTokenMs" INTEGER,
    "timeToLastTokenMs" INTEGER,
    "streamDurationMs" INTEGER,
    "totalChunks" INTEGER,
    "backendReceivedAt" TIMESTAMP(3),
    "backendRespondedAt" TIMESTAMP(3),
    "model" TEXT,
    "traceId" TEXT,
    "costUsd" DECIMAL(12,6),
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "cachedInputTokens" INTEGER,
    "reasoningTokens" INTEGER,
    "finishReason" TEXT,
    "historyCount" INTEGER,
    "historyTruncated" BOOLEAN,
    "sttProvider" TEXT,
    "sttLatencyMs" INTEGER,
    "detectedLanguage" TEXT,
    "languageConfidence" DECIMAL(4,3),
    "ttsProvider" TEXT,
    "ttsProtocol" TEXT,
    "ttsLatencyMs" INTEGER,
    "timeToFirstAudioMs" INTEGER,
    "voiceTotalLatencyMs" INTEGER,
    "totalSentences" INTEGER,
    "wsAvgFirstChunkLatencyMs" INTEGER,
    "wsTotalChunks" INTEGER,
    "wsTotalBytes" INTEGER,
    "waInboundId" TEXT,
    "waOutboundId" TEXT,
    "delivered" BOOLEAN,
    "replyMode" TEXT,
    "errored" BOOLEAN,
    "errorCode" TEXT,

    CONSTRAINT "chat_message_metrics_pkey" PRIMARY KEY ("messageId")
);

-- CreateIndex
CREATE INDEX "chat_message_metrics_createdAt_idx" ON "chat_message_metrics"("createdAt");

-- CreateIndex
CREATE INDEX "chat_message_metrics_sttProvider_idx" ON "chat_message_metrics"("sttProvider");

-- CreateIndex
CREATE INDEX "chat_message_metrics_ttsProvider_idx" ON "chat_message_metrics"("ttsProvider");

-- AddForeignKey
ALTER TABLE "chat_message_metrics" ADD CONSTRAINT "chat_message_metrics_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
