/**
 * Copy uploaded files into the configured object storage (STORAGE_* env) and
 * point the database at the copies. ADR-0023.
 *
 * Use it once per environment when storage moves to a new provider or bucket,
 * for example develop's images moving from Supabase Storage to Cloudflare R2.
 * It works between any two providers, because it reads each file through its
 * current public URL and writes it through the S3 API.
 *
 * For every `files` row whose bucket is not STORAGE_BUCKET:
 *   1. download the file from its current public URL,
 *   2. upload it to the configured storage,
 *   3. update the row (bucket, storageKey, publicUrl),
 *   4. replace the old URL with the new one in every agent theme config.
 *
 * Safe to run again: rows already in STORAGE_BUCKET are skipped, so a failed
 * run continues where it stopped. Old objects are not deleted; they go when
 * the old bucket or project is removed.
 *
 * Usage, from apps/api, with DATABASE_URL and STORAGE_* set for the target
 * environment:
 *   bunx tsx scripts/copy-files-to-object-storage.ts          # dry run
 *   bunx tsx scripts/copy-files-to-object-storage.ts --apply  # copy + update
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { ConfigService } from "@nestjs/config";
import type { ProviderEventLogger } from "../src/common/events/provider.logger";
import { ObjectStorageService } from "../src/services/object-storage.service";

const KEY_PREFIX = "agent-assets/";
const apply = process.argv.includes("--apply");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const config = {
    get: (key: string) => process.env[key],
  } as unknown as ConfigService;
  const noLog = { log: () => undefined } as unknown as ProviderEventLogger;
  const storage = new ObjectStorageService(config, noLog);
  storage.onModuleInit();
  if (!storage.bucket) {
    throw new Error("STORAGE_* env is incomplete; see apps/api/.env.example");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    const rows = await prisma.file.findMany({
      where: { bucket: { not: storage.bucket } },
      select: {
        id: true,
        bucket: true,
        storageKey: true,
        publicUrl: true,
        mimeType: true,
      },
      orderBy: { createdAt: "asc" },
    });

    console.log(
      `${rows.length} file(s) outside bucket "${storage.bucket}". Mode: ${apply ? "APPLY" : "dry run (pass --apply to write)"}`,
    );

    let copied = 0;
    let themesUpdated = 0;
    const failed: string[] = [];

    for (const row of rows) {
      const newKey = row.storageKey.startsWith(KEY_PREFIX)
        ? row.storageKey
        : `${KEY_PREFIX}${row.storageKey}`;
      const newUrl = storage.publicUrl(newKey);

      if (!apply) {
        console.log(`  would copy ${row.id}: ${row.publicUrl} -> ${newUrl}`);
        continue;
      }

      try {
        const res = await fetch(row.publicUrl);
        if (!res.ok) throw new Error(`download HTTP ${res.status}`);
        const body = Buffer.from(await res.arrayBuffer());

        await storage.upload(newKey, body, row.mimeType);

        await prisma.file.update({
          where: { id: row.id },
          data: {
            bucket: storage.bucket,
            storageKey: newKey,
            publicUrl: newUrl,
          },
        });

        // Theme configs hold image URLs as JSON string values. A URL contains
        // no character that JSON escapes, so a text replace is exact.
        themesUpdated += await prisma.$executeRaw`
          UPDATE agent_themes
          SET config = replace(config::text, ${row.publicUrl}, ${newUrl})::jsonb
          WHERE strpos(config::text, ${row.publicUrl}) > 0`;

        copied++;
        console.log(`  copied ${row.id} -> ${newUrl}`);
      } catch (err) {
        failed.push(row.id);
        console.error(
          `  FAILED ${row.id} (${row.publicUrl}): ${(err as Error).message}`,
        );
      }
    }

    if (apply) {
      console.log(
        `Done. Copied ${copied}, theme rows updated ${themesUpdated}, failed ${failed.length}.`,
      );
      if (failed.length) {
        console.log("Run again to retry the failed rows.");
        process.exitCode = 1;
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
