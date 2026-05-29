-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "supportedLanguages" TEXT[] DEFAULT ARRAY[]::TEXT[];
