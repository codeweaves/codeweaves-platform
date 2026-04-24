-- AlterTable
ALTER TABLE "llm_usage" ADD COLUMN     "cachedInputTokens" INTEGER,
ADD COLUMN     "reasoningTokens" INTEGER;
