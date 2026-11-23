import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { EventChannel } from "@prisma/client";
import { ProviderEventLogger } from "../common/events/provider.logger";

/** Which keys a `remove()` call deleted, and which it could not. */
export interface RemoveResult {
  removed: string[];
  failed: string[];
}

/** Parallel single-object deletes. See `remove()` for why not DeleteObjects. */
const DELETE_CONCURRENCY = 8;

/**
 * event_logs.provider for every storage call, whatever the vendor, so the ops
 * console filter keeps working after a provider move. The vendor
 * (STORAGE_PROVIDER) goes in the payload.
 */
const PROVIDER_LABEL = "STORAGE";

/**
 * File storage over the S3 API, so the provider is configuration, not code.
 * Cloudflare R2, AWS S3, Google Cloud Storage, DigitalOcean Spaces and OVH
 * Object Storage all speak it: moving between them means new STORAGE_* env
 * values and a copy of the objects. See docs/adr/0023-s3-api-object-storage.md.
 *
 * Only calls every one of those providers supports are used here.
 */
@Injectable()
export class ObjectStorageService implements OnModuleInit {
  private readonly logger = new Logger(ObjectStorageService.name);
  private client: S3Client | null = null;
  private bucketName = "";
  private publicBaseUrl = "";
  private vendor = "S3";

  constructor(
    private readonly configService: ConfigService,
    private readonly providerLog: ProviderEventLogger,
  ) {}

  onModuleInit() {
    const bucket = this.configService.get<string>("STORAGE_BUCKET");
    const accessKeyId = this.configService.get<string>("STORAGE_ACCESS_KEY_ID");
    const secretAccessKey = this.configService.get<string>(
      "STORAGE_SECRET_ACCESS_KEY",
    );
    const publicBaseUrl = this.configService.get<string>(
      "STORAGE_PUBLIC_BASE_URL",
    );

    if (!bucket || !accessKeyId || !secretAccessKey || !publicBaseUrl) {
      this.logger.warn(
        "STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY or STORAGE_PUBLIC_BASE_URL not set; file uploads are unavailable",
      );
      return;
    }

    const endpoint = this.configService.get<string>("STORAGE_ENDPOINT");
    const region = this.configService.get<string>("STORAGE_REGION");
    // Without an endpoint the SDK targets AWS S3 and builds the host from the
    // region, so "auto" would produce an address that does not exist.
    if (!endpoint && !region) {
      this.logger.warn(
        "STORAGE_REGION must be set when STORAGE_ENDPOINT is empty (AWS S3); file uploads are unavailable",
      );
      return;
    }

    this.bucketName = bucket;
    this.publicBaseUrl = publicBaseUrl.replace(/\/+$/, "");
    this.vendor = (
      this.configService.get<string>("STORAGE_PROVIDER") || "S3"
    ).toUpperCase();

    this.client = new S3Client({
      // AWS S3 needs no endpoint; every other provider does.
      endpoint: endpoint || undefined,
      // R2 expects "auto"; the rest expect their real region name.
      region: region || "auto",
      credentials: { accessKeyId, secretAccessKey },
      // Some S3-compatible servers (MinIO, Ceph) only accept path-style URLs.
      forcePathStyle:
        this.configService.get<string>("STORAGE_FORCE_PATH_STYLE") === "true",
      // Recent SDK versions send CRC32 checksum headers on every upload. Not
      // every S3-compatible provider accepts them, so send them only when the
      // operation itself requires one.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      // Callers are dashboard requests waiting on a 2 MB image at most, so
      // fail within ~30s in total rather than 3 attempts of a long timeout.
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 15_000 },
    });
    this.logger.log(`ObjectStorageService initialized (vendor=${this.vendor})`);
  }

  /** Public address of stored objects (STORAGE_PUBLIC_BASE_URL, no trailing slash). Empty when not configured. */
  get publicBase(): string {
    return this.publicBaseUrl;
  }

  /** The bucket new objects go to. Recorded on each file row. */
  get bucket(): string {
    return this.bucketName;
  }

  private ensureClient(): S3Client {
    if (!this.client) {
      throw new Error("Object storage is not configured");
    }
    return this.client;
  }

  /**
   * Store an object and return its public URL. Callers build keys that are
   * unique per upload, so the object never changes and browsers and CDNs may
   * cache it for good.
   */
  async upload(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<string> {
    const client = this.ensureClient();

    const start = performance.now();
    let errorMessage: string | undefined;
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    this.providerLog.log({
      channel: "DASHBOARD",
      eventName: errorMessage
        ? "STORAGE_UPLOAD_FAILED"
        : "STORAGE_UPLOAD_COMPLETED",
      direction: "OUTBOUND",
      provider: PROVIDER_LABEL,
      requestPayload: {
        vendor: this.vendor,
        bucket: this.bucketName,
        key,
        sizeBytes: body.length,
        contentType,
      },
      latencyMs: Math.round(performance.now() - start),
      success: !errorMessage,
      errorMessage,
    });

    if (errorMessage) {
      throw new Error(`Storage upload failed: ${errorMessage}`);
    }

    return this.publicUrl(key);
  }

  /**
   * Delete objects from `bucket` (the bucket recorded on the file rows).
   *
   * Throws only when storage is not configured at all, so callers stop before
   * deleting rows that would then point at nothing. Otherwise best effort:
   * failures are logged and never thrown, so a storage outage cannot block the
   * caller. The result says which keys are gone, so a caller that must not
   * lose track of an object (the file cleanup) keeps the rows of failed keys
   * and retries them.
   *
   * A bucket other than the configured one (rows written before a provider
   * move) cannot be reached with this config. That is logged as a failure,
   * not reported as a delete. scripts/copy-files-to-object-storage.ts moves
   * such rows to the configured bucket.
   *
   * One DeleteObject per key instead of the batch DeleteObjects call, because
   * Google Cloud Storage's S3 API does not support the batch call. Deleting a
   * key that does not exist succeeds on every provider.
   */
  async remove(
    bucket: string,
    keys: string[],
    channel: EventChannel = "DASHBOARD",
  ): Promise<RemoveResult> {
    if (keys.length === 0) return { removed: [], failed: [] };

    const client = this.ensureClient();

    if (bucket !== this.bucketName) {
      const errorMessage = `${keys.length} object(s) are in bucket "${bucket}", which this storage config cannot reach; run scripts/copy-files-to-object-storage.ts`;
      this.providerLog.log({
        channel,
        eventName: "STORAGE_REMOVE_FAILED",
        direction: "OUTBOUND",
        provider: PROVIDER_LABEL,
        requestPayload: { vendor: this.vendor, bucket, keyCount: keys.length },
        success: false,
        errorMessage,
      });
      this.logger.warn(`Storage remove skipped: ${errorMessage}`);
      return { removed: [], failed: [...keys] };
    }

    const start = performance.now();
    const failures: string[] = [];
    const removed: string[] = [];
    const failed: string[] = [];
    for (let i = 0; i < keys.length; i += DELETE_CONCURRENCY) {
      const batch = keys.slice(i, i + DELETE_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((key) =>
          client.send(
            new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }),
          ),
        ),
      );
      results.forEach((r, j) => {
        const key = batch[j]!;
        if (r.status === "rejected") {
          failed.push(key);
          failures.push(
            r.reason instanceof Error ? r.reason.message : String(r.reason),
          );
        } else {
          removed.push(key);
        }
      });
    }

    const errorMessage = failures.length
      ? `${failures.length} of ${keys.length} deletes failed: ${failures[0]}`
      : undefined;

    this.providerLog.log({
      channel,
      eventName: errorMessage
        ? "STORAGE_REMOVE_FAILED"
        : "STORAGE_REMOVE_COMPLETED",
      direction: "OUTBOUND",
      provider: PROVIDER_LABEL,
      requestPayload: {
        vendor: this.vendor,
        bucket: this.bucketName,
        keyCount: keys.length,
      },
      latencyMs: Math.round(performance.now() - start),
      success: !errorMessage,
      errorMessage,
    });

    if (errorMessage) {
      this.logger.warn(`Storage remove failed: ${errorMessage}`);
    }
    return { removed, failed };
  }

  /**
   * Public URL of an object: STORAGE_PUBLIC_BASE_URL plus the key. Point that
   * at our own domain (e.g. https://assets.getklivo.com), never a provider
   * URL: saved URLs then survive a change of provider.
   */
  publicUrl(key: string): string {
    this.ensureClient();
    const path = key.split("/").map(encodeURIComponent).join("/");
    return `${this.publicBaseUrl}/${path}`;
  }
}
