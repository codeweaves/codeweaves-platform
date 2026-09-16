import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI configuration, plus the guard that keeps schema-changing commands
 * off remote databases.
 *
 * Why this lives here rather than in a package.json script: Prisma loads this
 * file for EVERY CLI invocation, so the guard applies whether you run
 * `bun db:migrate`, `bunx prisma migrate dev`, or anything else. A script
 * wrapper only protects the one spelling somebody remembered to use.
 *
 * See docs/adr/0001-environments-and-deploy-pipeline.md. Feature branches ran
 * `prisma migrate dev` against the shared Supabase database and left six tables,
 * two enum types and a stray enum value behind. Only CI migrates a remote
 * database now.
 */

/**
 * Commands that CREATE or DESTROY schema outside the reviewed pipeline.
 *
 * `migrate deploy` is deliberately absent: that is precisely what CI runs
 * against staging and production, and it only applies migration files that are
 * already committed and reviewed. `migrate status`, `migrate diff`, `generate`,
 * `studio` and `db seed` are read-only or additive and stay unrestricted.
 */
const LOCAL_ONLY_COMMANDS: readonly (readonly string[])[] = [
  ["migrate", "dev"],
  ["migrate", "reset"],
  ["db", "push"],
];

/** Hosts that are this machine, or the Postgres container on this machine. */
const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "host.docker.internal",
  "postgres", // the service name inside docker compose
]);

/** True when argv contains these tokens consecutively, e.g. `migrate` `dev`. */
function argvHasSequence(
  argv: readonly string[],
  tokens: readonly string[],
): boolean {
  return argv.some((_, i) => tokens.every((t, j) => argv[i + j] === t));
}

function hostOf(url: string): string | null {
  try {
    // Postgres URLs parse as URLs; strip brackets so IPv6 compares cleanly.
    return new URL(url).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

export function assertLocalDatabase(
  url: string | undefined,
  argv: readonly string[] = process.argv,
): void {
  const attempted = LOCAL_ONLY_COMMANDS.find((tokens) =>
    argvHasSequence(argv, tokens),
  );
  if (!attempted) return;

  const command = `prisma ${attempted.join(" ")}`;

  if (!url) {
    throw new Error(
      `${command} needs DIRECT_URL or DATABASE_URL to be set. ` +
        "For local work, point it at the Docker Postgres: run `docker compose up -d` " +
        "and copy apps/api/.env.example.",
    );
  }

  const host = hostOf(url);
  if (host !== null && LOCAL_HOSTS.has(host)) return;

  throw new Error(
    `Refusing to run "${command}" against ${host ?? "an unparseable database URL"}.\n\n` +
      "This command creates or destroys schema, and it is only allowed against a local\n" +
      "database. Feature branches doing this against the shared database left six stray\n" +
      "tables behind (see docs/adr/0001-environments-and-deploy-pipeline.md).\n\n" +
      "For local work:\n" +
      "  docker compose up -d        # start Postgres on localhost:5432\n" +
      "  bun db:setup                # migrate + seed it\n\n" +
      "To change a remote schema: commit the migration, open a PR, and let CI run\n" +
      "`prisma migrate deploy`. That is the only supported path.",
  );
}

const datasourceUrl = process.env["DIRECT_URL"] || process.env["DATABASE_URL"];

assertLocalDatabase(datasourceUrl);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // Prisma 7 reads the seed command from HERE. The `prisma.seed` key in
    // package.json is the Prisma 6 location and is silently ignored, which left
    // `prisma db seed` a no-op after the upgrade.
    seed: "bun run prisma/seed.ts",
  },
  datasource: {
    url: datasourceUrl,
  },
});
