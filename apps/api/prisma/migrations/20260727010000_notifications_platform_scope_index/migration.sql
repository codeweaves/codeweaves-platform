-- Platform staff (ADMIN/SUPER_ADMIN with no organization of their own) read
-- notifications ACROSS all orgs — the same scope they already have in the
-- handover Inbox. Their list/count therefore filters on `createdAt` alone and
-- cannot use the (organizationId, createdAt) composite index, so give them a
-- dedicated one. Without it the badge count degrades to a full scan as the
-- table grows.
CREATE INDEX IF NOT EXISTS "notifications_createdAt_idx" ON "notifications"("createdAt" DESC);
