-- ROLLBACK for 20260704090000_rag_documents_and_integrations.
--
-- Prisma has no built-in down migrations; run this manually (Supabase SQL
-- editor or psql against DIRECT_URL) to fully revert the RAG + integrations
-- schema. The forward migration is PURELY ADDITIVE — it alters no existing
-- table — so this rollback only ever deletes the new feature's own data
-- (documents, chunks, integration credentials) and cannot affect agents,
-- chats, or any pre-existing rows.
--
-- After running this, also check out a commit before the feature (or revert
-- the feature commits) so Prisma client code no longer references the models,
-- and run `bunx prisma generate`.

-- Drop dependents first (chunks reference documents; both reference agents).
DROP TABLE IF EXISTS "agent_document_chunks";
DROP TABLE IF EXISTS "agent_documents";
DROP TABLE IF EXISTS "agent_integrations";

DROP TYPE IF EXISTS "AgentDocumentStatus";
DROP TYPE IF EXISTS "AgentDocumentSourceType";

-- Deliberately NOT dropped: the `vector` extension. It's harmless when
-- unused, and dropping it would break anything else that adopted it since.

-- Tell Prisma the migration is no longer applied, so a future
-- `migrate deploy` can re-apply it cleanly if the feature returns.
DELETE FROM "_prisma_migrations"
WHERE "migration_name" = '20260704090000_rag_documents_and_integrations';
