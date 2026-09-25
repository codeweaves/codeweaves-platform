-- Widget consent records + device-based visitor identity (ADR-0004).

-- CreateEnum
CREATE TYPE "ConsentAction" AS ENUM ('GRANTED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "consentId" TEXT,
ADD COLUMN     "ipHash" VARCHAR(40);

-- CreateTable
CREATE TABLE "visitor_consents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "source" "ChatSource" NOT NULL,
    "action" "ConsentAction" NOT NULL,
    "method" VARCHAR(32) NOT NULL,
    "noticeText" TEXT NOT NULL,
    "linkText" VARCHAR(40) NOT NULL,
    "privacyPolicyUrl" VARCHAR(2048) NOT NULL,
    "buttonLabel" VARCHAR(30) NOT NULL,
    "noticeHash" VARCHAR(64) NOT NULL,
    "ipHash" VARCHAR(40),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitor_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visitor_consents_agentId_visitorId_createdAt_idx" ON "visitor_consents"("agentId", "visitorId", "createdAt");

-- CreateIndex
CREATE INDEX "visitor_consents_organizationId_visitorId_idx" ON "visitor_consents"("organizationId", "visitorId");

-- CreateIndex
CREATE INDEX "chat_sessions_consentId_idx" ON "chat_sessions"("consentId");

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "visitor_consents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitor_consents" ADD CONSTRAINT "visitor_consents_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: web sessions created before this migration keyed the visitor by a
-- hashed IP (vh_...). Copy it into the new attribute column. visitorId is left
-- as it is for these legacy rows; new rows get the device-based vd_ id.
UPDATE "chat_sessions" SET "ipHash" = "visitorId" WHERE "visitorId" LIKE 'vh\_%';
