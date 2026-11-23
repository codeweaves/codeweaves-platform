# ADR-0023: File storage over the S3 API, Cloudflare R2 first

- **Status:** Accepted
- **Date:** 2026-11-20
- **Deciders:** Dhruv (leave Supabase Storage in production, use Cloudflare R2 there, the code must not change when the provider changes; develop and staging stay on their free Supabase Storage through the S3 API until prod, so no card is on file before it is needed). Implementation details (S3 API, own public domain, single-object deletes) chosen during the build.

Supersedes the **production storage** row of [ADR-0002](0002-production-hosting-and-region.md). The rest of ADR-0002 still stands.

## Context

ADR-0002 put production files in Supabase Storage, in the same project as the database. Production will not run on Supabase, so storage needs a new home.

What the code stores today:

- Agent branding images only: header logo, bot avatar, user avatar, icon, brand logo. Raster only (PNG, JPEG, GIF, WebP), 2 MB maximum, type checked from the file bytes.
- The images are shown in the widget on client websites, so they must be publicly readable.
- The full public URL is saved in the `files` row and in the agent theme. A URL that names the provider breaks when the provider changes.

The old code called the Supabase SDK directly (`supabase-storage.service.ts`, three methods: upload, remove, public URL). Any other provider meant a rewrite.

What we know about R2 data location (Cloudflare docs, page dated 2026-08-19): R2 can guarantee storage only inside the EU, US or FedRAMP. The nearest location hint, `apac`, is "a best effort and not a guarantee", and names no country. India is not a guaranteed location.

## The four questions

- **Blast radius:** dashboard uploads and every widget that shows a logo or avatar. If storage is down, uploads fail and images do not load. Chat still works.
- **One-way or two-way door:** two-way. Objects copy between S3 providers with standard tools (for example `rclone`), and the code does not change.
- **Couples us to:** the S3 API, which every major object store implements. Not to any one vendor.
- **Cost of waiting:** production needs storage before go-live. Each upload made on a vendor URL adds to the later migration.

## Decision

1. **The API talks to storage only through the S3 API** (`@aws-sdk/client-s3`), in `apps/api/src/services/object-storage.service.ts`. The provider is configuration:

   | Env var                                               | Purpose                                                 |
   | ----------------------------------------------------- | ------------------------------------------------------- |
   | `STORAGE_PROVIDER`                                    | label in `event_logs.provider` (`R2`, `S3`, `GCS`, ...) |
   | `STORAGE_ENDPOINT`                                    | provider's S3 address; empty for AWS S3                 |
   | `STORAGE_REGION`                                      | `auto` for R2, the real region elsewhere                |
   | `STORAGE_BUCKET`                                      | bucket name                                             |
   | `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | S3 keys, scoped to the one bucket                       |
   | `STORAGE_PUBLIC_BASE_URL`                             | public address files are served from                    |
   | `STORAGE_FORCE_PATH_STYLE`                            | `true` only for servers that need it (MinIO, Ceph)      |

2. **Providers per environment.** Production: Cloudflare R2, set up at prod launch. Local, develop and staging: their existing free Supabase projects' Storage, through Supabase's S3 endpoint (`https://<ref>.supabase.co/storage/v1/s3`, path-style, project region), with no Supabase SDK. R2 has no hard spending cap (budget alerts only email), so its card goes on file only when prod needs it.
3. **Files are served from our own domain** (for example `https://assets.getklivo.com`), set in `STORAGE_PUBLIC_BASE_URL`, never from a provider URL. Saved URLs then survive a change of provider: copy the objects, point the domain at the new provider, change the env.
4. **Only calls every S3-compatible provider supports.** Uploads are single `PutObject`. Deletes are one `DeleteObject` per key, 8 at a time, because Google Cloud Storage's S3 API has no batch delete. Checksum headers are sent only when an operation requires them, because not every provider accepts the SDK's default CRC32 headers.
5. **Object keys are unique per upload** (`agent-assets/<org>/<agent>/<purpose>/<timestamp>-<name>`), so objects never change and are served with `Cache-Control: public, max-age=31536000, immutable`.
6. **Each `files` row records its bucket, and deletes go to that bucket.** A row in a bucket other than `STORAGE_BUCKET` (written before a provider move) cannot be reached with the current config: its delete is logged as `STORAGE_REMOVE_FAILED`, never reported as done. `apps/api/scripts/copy-files-to-object-storage.ts` moves such rows: it copies each file through its public URL, updates the row, and rewrites the URL in agent theme configs. It runs as a dry run unless given `--apply`, and is safe to run again.
7. **Buckets.** Local and develop share the develop project's `agent_assets` bucket (keys carry org and agent ids, so they never collide). Staging uses its own project's `agent_assets`. Prod gets `klivo-assets-prod` on R2 behind `assets.getklivo.com`. Each environment has its own S3 key.
8. **`@supabase/supabase-js` is removed** from the API. It was used only for storage.

Rules that follow:

- No provider SDK other than the S3 client. A feature that needs a provider-only API needs a new ADR.
- Private files (for example RAG knowledge documents) go to a separate, private bucket and are read through presigned URLs, which every S3 provider supports. They never go in the public branding bucket.

## Options rejected

### Keep Supabase Storage, as ADR-0002 decided

**Good:** already built and working on develop. One vendor for database and files. Supabase Storage now also speaks the S3 API.

**Rejected because:** production will not run on Supabase, and the code called the Supabase SDK directly, so staying would tie storage to a vendor we are leaving.

### Call the R2 or Cloudflare API directly (Workers binding or R2-only client)

**Good:** fewer settings, direct access to R2-only features, and Cloudflare's own tooling.

**Rejected because:** it repeats the Supabase mistake. A move to AWS, Google Cloud, DigitalOcean or OVH would mean new code. The requirement is that a provider change is configuration only.

### Google Cloud Storage in `asia-south1` (Mumbai)

**Good:** guaranteed India location, which matches the client privacy statement, and the same cloud as the planned Cloud Run API.

**Rejected because:** Dhruv chose R2 for now. Because the code is S3-only, moving to Google Cloud Storage later is a configuration change.

**Revisit if:** personal data (for example knowledge documents) must be stored and the India location statement must stay true.

### A small client such as `aws4fetch` instead of the AWS SDK

**Good:** much smaller dependency, and it works with every S3 provider.

**Rejected because:** the AWS SDK is the standard S3 client, maintained by AWS, with retries, timeouts and presigned URLs built in. Install size does not matter on a server.

## Consequences

- Moving storage provider means: create the bucket, point the `assets` domain at it, change the `STORAGE_*` env, run the copy script. No code change.
- **India location is not guaranteed on R2.** The client Privacy Risk Assessment says "All client personal data stored in India." Branding images are not personal data, so this holds today. Before personal data is stored in R2, either that statement changes or that data goes to an India-located bucket (configuration only).
- **No backup is included.** R2, like Supabase Storage, keeps no backup copy. The nightly file copy on the go-live list is still needed. `rclone` copies between any two S3 providers.
- **Develop data:** develop keeps its `agent_assets` bucket, so its existing rows and theme URLs stay valid and need no copy. The copy script is for the next real move (for example develop or staging to R2).
- The web dashboard reads `NEXT_PUBLIC_STORAGE_PUBLIC_URL` instead of `NEXT_PUBLIC_SUPABASE_URL` for its CSP. Storage was also removed from `connect-src`, because the browser only loads these files as images.
- Event names changed: `SUPABASE_STORAGE_*` is now `STORAGE_UPLOAD_*` / `STORAGE_REMOVE_*`, with `provider` from `STORAGE_PROVIDER`. Old rows keep their old names.
- R2 needs a Cloudflare account with a payment card on file. The free tier covers 10 GB and has no egress fees, but there is no hard spending cap: set a budget alert when prod's card is added. Public reads are the only usage a stranger can drive; serving through our own domain lets Cloudflare's cache absorb repeats.

## Open questions

- Production database host. ADR-0002's Supabase choice for the database is not changed by this ADR. Dhruv decides.
- Where knowledge documents are stored when RAG merges (R2 with an updated privacy statement, or an India-located bucket). Dhruv decides.
