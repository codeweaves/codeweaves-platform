-- CreateTable
CREATE TABLE "pii_tokens" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "chatSessionId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "valueHash" TEXT NOT NULL,
    "valueEncrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pii_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pii_tokens_chatSessionId_token_key" ON "pii_tokens"("chatSessionId", "token");

-- CreateIndex
CREATE UNIQUE INDEX "pii_tokens_chatSessionId_valueHash_key" ON "pii_tokens"("chatSessionId", "valueHash");

-- CreateIndex
CREATE INDEX "pii_tokens_organizationId_idx" ON "pii_tokens"("organizationId");
