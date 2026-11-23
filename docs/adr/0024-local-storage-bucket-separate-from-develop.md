# ADR-0024: Local file storage uses its own bucket, never develop's

- **Status:** Accepted
- **Date:** 2026-11-24
- **Deciders:** Dhruv (wanted local storage kept separate from develop, 2026-11-23). The safety reason below was found while testing the file cleanup.

Supersedes decision 7 of [ADR-0023](0023-s3-api-object-storage.md) for **local** only: "Local and develop share the develop project's `agent_assets` bucket". Develop, staging and prod buckets are unchanged.

## Context

Local development stores uploads in the develop Supabase project, through its S3 endpoint (ADR-0023). Until now it used the same bucket as develop, `agent_assets`, on the reasoning that object keys carry org and agent ids, so keys never collide.

Collisions were not the risk. The local database is often restored from develop (`pg_dump`), so it holds copies of develop's `files` rows: on 2026-11-24 it had 24 of them (Klivo, ELGi, Sanman, P&P and others), each pointing at an object develop's live widgets use.

Since uploaded files are deleted when a theme stops using them (the file-cleanup change after ADR-0023), local code can delete objects:

- Editing a copied agent locally and saving a new logo deletes the old logo object, which is develop's live logo.
- The daily cleanup, run locally, deletes every object the local themes do not use, which includes develop's objects whose local theme copies are older.

Either way a developer's laptop breaks develop's widgets, with no error locally.

## The four questions

- **Blast radius:** develop's live widgets lose images. Develop is shared and used for demos.
- **One-way or two-way door:** a deleted object cannot be restored (Supabase Storage keeps no backup). Separating the bucket is a config change and fully reversible.
- **Couples us to:** nothing new. One more bucket in the develop project.
- **Cost of waiting:** the next local save of a copied agent deletes a develop file.

## Decision

1. **Local uses its own bucket, `agent_assets_local`**, in the develop Supabase project (public), set in `apps/api/.env` as `STORAGE_BUCKET=agent_assets_local` and `STORAGE_PUBLIC_BASE_URL=https://<develop-ref>.supabase.co/storage/v1/object/public/agent_assets_local`.
2. Copied develop rows stay in the local database. Their bucket is `agent_assets`, which local code cannot reach: deleting them is refused, and the daily cleanup only considers the configured bucket. Their images still display, because displaying only reads the public URL.
3. Rule for any future environment: **an environment whose database may hold copies of another environment's rows never shares that environment's bucket.**

## Options rejected

### Keep sharing develop's bucket

**Good:** one bucket fewer, and uploads made locally are visible from develop with the same URL.

**Rejected because:** local code can then delete develop's live files, as described above.

### Share the bucket, but disable file deletes locally

**Good:** no extra bucket, and no deletes can reach develop.

**Rejected because:** local could then never exercise the delete paths it is meant to test, and a flag that turns safety off by environment is easy to get wrong in one place.

## Consequences

- Local uploads do not appear in develop's bucket, which is intended.
- Copied develop rows cannot be deleted locally. To test deletes, use agents created locally (for example the `/verify` sandbox).
- The `agent_assets_local` bucket must exist in the develop project. If it is removed, local uploads fail with "Bucket not found".
