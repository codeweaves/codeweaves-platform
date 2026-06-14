-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "fallbackPhrases" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "chat_message_metrics" ADD COLUMN     "couldntAnswer" BOOLEAN,
ADD COLUMN     "couldntAnswerScore" DECIMAL(4,3);
