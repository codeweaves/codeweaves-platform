-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "voiceConfig" JSONB,
ADD COLUMN     "voiceEnabled" BOOLEAN NOT NULL DEFAULT false;
