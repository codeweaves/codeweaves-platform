-- RAG documents (pgvector) + third-party agent integrations.
--
-- pgvector: available on Supabase out of the box; CREATE EXTENSION is
-- idempotent. Requires pgvector >= 0.7 for HNSW (Supabase ships newer).
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "AgentDocumentStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentDocumentSourceType" AS ENUM ('FILE', 'URL');

-- CreateTable
CREATE TABLE "agent_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "sourceType" "AgentDocumentSourceType" NOT NULL,
    "sourceUrl" VARCHAR(2048),
    "mimeType" VARCHAR(127),
    "sizeBytes" INTEGER,
    "status" "AgentDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "chunkingStrategy" VARCHAR(32) NOT NULL DEFAULT 'recursive',
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "contentHash" VARCHAR(64),
    "rawText" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_document_chunks" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "embedding" vector(1536),
    -- Generated full-text column for hybrid retrieval (vector + FTS with RRF).
    "searchVector" tsvector GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_integrations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "credentialsEncrypted" TEXT NOT NULL,
    "credentialHint" VARCHAR(120) NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(16) NOT NULL DEFAULT 'connected',
    "lastTestedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_documents_agentId_status_idx" ON "agent_documents"("agentId", "status");

-- CreateIndex
CREATE INDEX "agent_documents_organizationId_idx" ON "agent_documents"("organizationId");

-- CreateIndex
CREATE INDEX "agent_document_chunks_documentId_idx" ON "agent_document_chunks"("documentId");

-- CreateIndex
CREATE INDEX "agent_document_chunks_agentId_idx" ON "agent_document_chunks"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_integrations_agentId_provider_key" ON "agent_integrations"("agentId", "provider");

-- CreateIndex
CREATE INDEX "agent_integrations_organizationId_idx" ON "agent_integrations"("organizationId");

-- Vector index: HNSW, cosine distance. ef_construction=200 per production
-- tuning research (default 64 under-builds the graph). Query-time recall is
-- tuned with `SET LOCAL hnsw.ef_search` in the retrieval service.
CREATE INDEX "agent_document_chunks_embedding_idx"
    ON "agent_document_chunks" USING hnsw ("embedding" vector_cosine_ops)
    WITH (m = 16, ef_construction = 200);

-- Full-text index for the hybrid retrieval path.
CREATE INDEX "agent_document_chunks_search_vector_idx"
    ON "agent_document_chunks" USING gin ("searchVector");

-- AddForeignKey
ALTER TABLE "agent_documents" ADD CONSTRAINT "agent_documents_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_document_chunks" ADD CONSTRAINT "agent_document_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "agent_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_integrations" ADD CONSTRAINT "agent_integrations_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
