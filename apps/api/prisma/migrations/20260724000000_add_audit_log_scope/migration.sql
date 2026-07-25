-- AlterTable: add typed tenancy scope to audit_logs (DPDP — queryable "what
-- happened where" + org-scoped erasure). Both nullable; no backfill needed.
ALTER TABLE "audit_logs" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "agentId" TEXT;

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_idx" ON "audit_logs"("organizationId");

-- CreateIndex
CREATE INDEX "audit_logs_agentId_idx" ON "audit_logs"("agentId");
