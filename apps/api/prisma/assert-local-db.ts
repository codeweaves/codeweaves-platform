/// <reference types="node" />
import "dotenv/config";
import { assertLocalDatabase } from "../prisma.config";

/**
 * Gate for `bun db:setup`, which is a LOCAL command by definition: it starts
 * Docker containers, migrates them and seeds a super admin.
 *
 * Without this, running it with a staging URL still in `.env` would apply
 * migrations to staging and create a super-admin account there. `migrate deploy`
 * on its own cannot be blocked, because that is exactly what CI runs.
 *
 * Reuses the guard from prisma.config.ts by asking it the same question with a
 * synthetic argv, so there is one definition of "is this database local".
 */
assertLocalDatabase(process.env.DATABASE_URL ?? process.env.DIRECT_URL, [
  "node",
  "prisma",
  "migrate",
  "dev",
]);
