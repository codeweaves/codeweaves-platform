import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';
import { AppLogger } from '../logger/app-logger';

/** Marker prefix on encrypted CollectedData field values (`enc:v1:<iv:ct:tag>`). */
const FIELD_VALUE_PREFIX = 'enc:v1:';
/** Marker prefix on hashed visitor IPs so a hash is never mistaken for an IP. */
const VISITOR_HASH_PREFIX = 'vh_';

@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly log = new AppLogger(CryptoService.name);
  private key!: Buffer;
  private derivedHmacKey!: Buffer;
  private visitorIpHmacKey!: Buffer;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const hex = this.configService.get<string>('AGENT_SECRET_KEY');
    if (!hex) {
      throw new Error('AGENT_SECRET_KEY environment variable is required');
    }
    this.key = Buffer.from(hex, 'hex');
    if (this.key.length !== 32) {
      throw new Error(
        'AGENT_SECRET_KEY must be a 64-character hex string (32 bytes)',
      );
    }
    // Domain-separated key for keyed hashing (PII value lookup): never use
    // the raw AES key directly for a second purpose.
    this.derivedHmacKey = createHmac('sha256', this.key)
      .update('pii-value-hash-v1')
      .digest();
    // Separate domain for visitor-IP hashing (DPDP data minimisation): a
    // keyed hash keeps "same visitor" linkage without retaining the raw IP.
    this.visitorIpHmacKey = createHmac('sha256', this.key)
      .update('visitor-ip-hash-v1')
      .digest();
    this.log.info('onModuleInit', 'CryptoService initialized');
  }

  /** Derived key for HMAC-based lookups (e.g. PiiToken.valueHash). */
  hmacKey(): Buffer {
    return this.derivedHmacKey;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
  }

  decrypt(encrypted: string): string {
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted value format');
    }
    const ivHex = parts[0]!;
    const dataHex = parts[1]!;
    const tagHex = parts[2]!;
    const iv = Buffer.from(ivHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(data).toString('utf8') + decipher.final('utf8');
  }

  /**
   * One-way keyed hash of a visitor IP (DPDP data minimisation — S1).
   *
   * Deterministic: the same IP always maps to the same `vh_…` token, so
   * distinct-visitor analytics, returning-visitor detection and session
   * backfill all keep working — but the raw IP is never stored.
   *
   * Returns `undefined` for missing/loopback IPs (local dev noise): storing
   * nothing lets the session backfill logic fill in the real visitor hash
   * when a later request carries a usable address.
   */
  hashVisitorIp(ip: string | undefined | null): string | undefined {
    if (!ip) return undefined;
    const trimmed = ip.trim();
    if (
      trimmed === '' ||
      trimmed === '::1' ||
      trimmed === '127.0.0.1' ||
      trimmed.startsWith('::ffff:127.')
    ) {
      return undefined;
    }
    // Already hashed (defensive — double-hashing would break linkage).
    if (trimmed.startsWith(VISITOR_HASH_PREFIX)) return trimmed;
    const digest = createHmac('sha256', this.visitorIpHmacKey)
      .update(trimmed)
      .digest('hex');
    // 32 hex chars = 128 bits — collision-safe at any realistic visitor count.
    return `${VISITOR_HASH_PREFIX}${digest.slice(0, 32)}`;
  }

  /**
   * Encrypt every VALUE of a collected-data record, leaving keys plaintext
   * (S1 — lead PII at rest). Keys stay readable because the dashboard derives
   * its columns via `jsonb_object_keys(data)`; values are what's sensitive.
   * Values are JSON-serialized before encryption so numbers/booleans survive
   * the round-trip. Already-encrypted values pass through untouched.
   */
  encryptFieldValues(
    data: Record<string, unknown>,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string' && value.startsWith(FIELD_VALUE_PREFIX)) {
        out[key] = value; // already encrypted
        continue;
      }
      out[key] = `${FIELD_VALUE_PREFIX}${this.encrypt(JSON.stringify(value))}`;
    }
    return out;
  }

  /**
   * Reverse of {@link encryptFieldValues}. Tolerates legacy plaintext values
   * (rows written before S1) and returns them as-is; a value that carries the
   * prefix but fails to decrypt/parse is surfaced as null rather than
   * throwing — one corrupt field must not take down a whole table read.
   */
  decryptFieldValues(
    data: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> {
    if (!data) return {};
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== 'string' || !value.startsWith(FIELD_VALUE_PREFIX)) {
        out[key] = value; // legacy plaintext row
        continue;
      }
      try {
        out[key] = JSON.parse(
          this.decrypt(value.slice(FIELD_VALUE_PREFIX.length)),
        ) as unknown;
      } catch {
        this.log.warn(
          'decryptFieldValues',
          `failed to decrypt collected-data field "${key}"`,
        );
        out[key] = null;
      }
    }
    return out;
  }
}
