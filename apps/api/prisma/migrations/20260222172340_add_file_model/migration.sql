-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "publicUrl" TEXT NOT NULL,
    "bucket" TEXT NOT NULL DEFAULT 'agent-assets',
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "files_entityType_entityId_idx" ON "files"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "files_organizationId_idx" ON "files"("organizationId");

-- CreateIndex
CREATE INDEX "files_uploadedById_idx" ON "files"("uploadedById");
