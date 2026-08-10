-- Invitations carry the role set the invited account starts with.
--
-- Before this, every invited CLIENT was provisioned as `org.owner`, because the
-- signup path could only map the legacy three-value `role` enum. That meant an
-- invite could not express "inbox agent only": the person arrived with full
-- control of the organization and had to be demoted afterwards.
--
-- Defaults to an empty array rather than backfilling. `createFromInvitation`
-- treats empty as "use the legacy mapping", so pending invitations created
-- before this migration still resolve exactly as they did.
-- Shape matches exactly what Prisma generates for `String[] @default([])`, so
-- `migrate diff` reports no drift and a later `migrate dev` will not try to
-- "correct" this column.
ALTER TABLE "user_invitations"
  ADD COLUMN "roleKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];
