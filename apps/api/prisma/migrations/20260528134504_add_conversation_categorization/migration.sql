-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "categoryKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "categorizedAt" TIMESTAMP(3),
ADD COLUMN     "category" VARCHAR(100),
ADD COLUMN     "detectedLanguage" VARCHAR(8);

-- CreateIndex
CREATE INDEX "chat_sessions_category_idx" ON "chat_sessions"("category");

-- CreateIndex
CREATE INDEX "chat_sessions_detectedLanguage_idx" ON "chat_sessions"("detectedLanguage");
