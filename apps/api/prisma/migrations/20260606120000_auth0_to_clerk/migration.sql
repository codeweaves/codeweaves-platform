-- Auth0 -> Clerk migration.
-- Production-safe: RENAME keeps the tables and data intact (Prisma's default
-- diff would DROP + ADD, which is destructive). Existing User.clerkId values are
-- nulled on purpose — the old Auth0 subject IDs are useless under Clerk. Each
-- user's real Clerk user id is set afterward (set manually, or via re-invite).

-- users.auth0Id -> users.clerkId (now nullable)
ALTER TABLE "users" RENAME COLUMN "auth0Id" TO "clerkId";
ALTER TABLE "users" ALTER COLUMN "clerkId" DROP NOT NULL;
ALTER INDEX "users_auth0Id_key" RENAME TO "users_clerkId_key";
ALTER INDEX "users_auth0Id_idx" RENAME TO "users_clerkId_idx";

-- user_invitations.auth0UserId -> user_invitations.clerkInvitationId
ALTER TABLE "user_invitations" RENAME COLUMN "auth0UserId" TO "clerkInvitationId";

-- audit_logs.auth0Id -> audit_logs.clerkId
ALTER TABLE "audit_logs" RENAME COLUMN "auth0Id" TO "clerkId";
ALTER INDEX "audit_logs_auth0Id_idx" RENAME TO "audit_logs_clerkId_idx";

-- Clear stale Auth0 subject IDs; the real Clerk user id is set per user afterward.
UPDATE "users" SET "clerkId" = NULL;
