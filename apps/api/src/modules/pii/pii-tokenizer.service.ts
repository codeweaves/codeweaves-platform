import { createHmac } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';

import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../services/prisma.service';

import { PiiDetectionService } from './pii-detection.service';
import { last4Of, type PiiCategory } from './pii-patterns';

/** Matches placeholders we emit: [EMAIL_1], [BANK_ACCOUNT_2], ... */
export const TOKEN_PATTERN = /\[([A-Z_]+)_(\d+)\]/g;

/**
 * Per-turn tokenization context for one chat session. Created via
 * `PiiTokenizerService.forSession()` — loads the session's existing token map
 * ONCE, then `tokenize()`/`detokenize()` are pure string ops. New tokens
 * minted during the turn are persisted in a single `flush()` write.
 *
 * Token stability: the same value maps to the same placeholder across every
 * turn of a session (`[EMAIL_1]` always means the same address), which is what
 * lets the model refer to placeholders coherently and lets tool arguments be
 * re-hydrated later.
 */
export class PiiSessionContext {
  /** valueHash → token */
  private readonly byHash = new Map<string, string>();
  /** token → plaintext value */
  private readonly byToken = new Map<string, string>();
  /** category → highest index minted so far */
  private readonly counters = new Map<string, number>();
  /** Tokens minted this turn, pending flush(). */
  private readonly pending: Array<{
    category: string;
    token: string;
    valueHash: string;
    value: string;
  }> = [];

  constructor(
    readonly organizationId: string,
    readonly chatSessionId: string,
    private readonly svc: PiiTokenizerService,
  ) {}

  /** @internal populate from persisted rows */
  seed(rows: Array<{ category: string; token: string; value: string; valueHash: string }>): void {
    for (const row of rows) {
      this.byHash.set(row.valueHash, row.token);
      this.byToken.set(row.token, row.value);
      const idx = parseIndex(row.token);
      const current = this.counters.get(row.category) ?? 0;
      if (idx > current) this.counters.set(row.category, idx);
    }
  }

  get hasTokens(): boolean {
    return this.byToken.size > 0 || this.pending.length > 0;
  }

  /**
   * Replace TOKENIZE-tier entities in `text` with stable placeholders.
   * Synchronous — detection is pure CPU and the map is already loaded.
   */
  tokenize(text: string): string {
    if (!text) return text;
    const matches = this.svc.detection
      .detect(text)
      .filter((m) => m.tier === 'TOKENIZE');
    if (matches.length === 0) return text;

    let out = '';
    let cursor = 0;
    for (const m of matches) {
      out += text.slice(cursor, m.start) + this.tokenFor(m.category, m.value);
      cursor = m.end;
    }
    out += text.slice(cursor);
    return out;
  }

  /** Replace known placeholders in `text` with their real values. */
  detokenize(text: string): string {
    if (!text || !this.hasTokens) return text;
    return text.replace(TOKEN_PATTERN, (whole) => this.byToken.get(whole) ?? whole);
  }

  /** True when this turn minted new tokens not yet persisted. */
  get hasPending(): boolean {
    return this.pending.length > 0;
  }

  /** Persist tokens minted this turn. Idempotent; safe to fire-and-forget. */
  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0);
    await this.svc.persist(this.organizationId, this.chatSessionId, batch);
  }

  /**
   * Persist minted tokens, THROWING on failure. Used by the transcript-storage
   * path (`redactForStorage`), where the vault is the ONLY home of the real
   * value — so a lost write must be caught, not swallowed.
   */
  async flushOrThrow(): Promise<void> {
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0);
    await this.svc.persistStrict(this.organizationId, this.chatSessionId, batch);
  }

  private tokenFor(category: PiiCategory, value: string): string {
    const hash = this.svc.hashValue(this.chatSessionId, value);
    const existing = this.byHash.get(hash);
    if (existing) return existing;
    const next = (this.counters.get(category) ?? 0) + 1;
    this.counters.set(category, next);
    const token = `[${category}_${next}]`;
    this.byHash.set(hash, token);
    this.byToken.set(token, value);
    this.pending.push({ category, token, valueHash: hash, value });
    return token;
  }
}

/**
 * PiiTokenizerService: the reversible half of PII redaction (the "vault").
 *
 * Values are AES-256-GCM encrypted at rest (CryptoService, same key domain as
 * agent credentials) and looked up via a keyed HMAC of the plaintext — a plain
 * SHA-256 of a phone number is trivially brute-forceable, an HMAC keyed by the
 * server secret is not.
 *
 * Multi-tenancy: every row carries organizationId; token uniqueness is scoped
 * to the chat session, so placeholders never collide or leak across tenants.
 */
@Injectable()
export class PiiTokenizerService {
  private readonly logger = new Logger(PiiTokenizerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    readonly detection: PiiDetectionService,
  ) {}

  /**
   * Load the session's token map (one indexed query) and return a context for
   * this turn. On DB failure returns an EMPTY context — tokenization then
   * mints session-locally-consistent tokens for this turn and `flush()` will
   * try to persist them; redaction must degrade to "still redacts", never to
   * "sends raw PII because a query failed".
   */
  async forSession(organizationId: string, chatSessionId: string): Promise<PiiSessionContext> {
    const ctx = new PiiSessionContext(organizationId, chatSessionId, this);
    try {
      const rows = await this.prisma.piiToken.findMany({
        // Tenant boundary: a session UUID already scopes to one org, but filter
        // on organizationId too so a cross-tenant read is impossible by construction.
        where: { chatSessionId, organizationId },
        select: { category: true, token: true, valueEncrypted: true, valueHash: true },
      });
      ctx.seed(
        rows.map((r) => ({
          category: r.category,
          token: r.token,
          valueHash: r.valueHash,
          value: this.crypto.decrypt(r.valueEncrypted),
        })),
      );
    } catch (err) {
      this.logger.warn(
        `PII token map load failed for session ${chatSessionId} — continuing with empty map. ${err instanceof Error ? err.message : ''}`,
      );
    }
    return ctx;
  }

  /** @internal */
  hashValue(chatSessionId: string, value: string): string {
    // Session-scoped HMAC so identical values in different sessions produce
    // different hashes (no cross-session correlation via the hash column).
    return createHmac('sha256', this.crypto.hmacKey())
      .update(chatSessionId)
      .update(' ')
      .update(value.trim().toLowerCase())
      .digest('hex');
  }

  /**
   * @internal Strict persist — throws on failure. Used by the transcript-storage
   * path where a lost row means an unrecoverable value. `last4` is stored in
   * plaintext for masked display; the full value is always AES-encrypted.
   */
  async persistStrict(
    organizationId: string,
    chatSessionId: string,
    batch: Array<{ category: string; token: string; valueHash: string; value: string }>,
  ): Promise<void> {
    await this.prisma.piiToken.createMany({
      data: batch.map((b) => ({
        organizationId,
        chatSessionId,
        category: b.category,
        token: b.token,
        valueHash: b.valueHash,
        valueEncrypted: this.crypto.encrypt(b.value),
        last4: last4Of(b.value),
      })),
      skipDuplicates: true,
    });
  }

  /** @internal Best-effort persist for the LLM-side flush; swallows errors
   *  because the transcript-storage path is the durable one. A lost row means a
   *  later turn mints a new placeholder for the same value — cosmetic. */
  async persist(
    organizationId: string,
    chatSessionId: string,
    batch: Array<{ category: string; token: string; valueHash: string; value: string }>,
  ): Promise<void> {
    try {
      await this.persistStrict(organizationId, chatSessionId, batch);
    } catch (err) {
      this.logger.warn(
        `PII token persist failed for session ${chatSessionId}: ${err instanceof Error ? err.message : ''}`,
      );
    }
  }

  /**
   * Produce the safe-to-store version of visitor-authored text:
   *   - HARD_DROP-tier (card/Aadhaar/passport/...) masked irreversibly,
   *   - VAULT-tier (bank/DOB/PAN/IFSC) replaced with stable tokens whose real
   *     values are DURABLY written to the vault BEFORE the token is returned.
   *
   * If the vault write fails we mask VAULT-tier instead of tokenising, so we
   * never persist a token whose value we could not store (privacy-safe: the
   * value becomes unrecoverable rather than leaked). See
   * docs/security/pii-handling-spec.md §5-6.
   */
  async redactForStorage(
    organizationId: string,
    chatSessionId: string,
    content: string,
  ): Promise<string> {
    const destroyed = this.detection.maskHardDrop(content);
    const ctx = await this.forSession(organizationId, chatSessionId);
    const tokenized = ctx.tokenize(destroyed);
    // Nothing NEW to persist (no VAULT-tier, or all values already vaulted):
    // the tokenised string is already safe and consistent with the vault.
    if (!ctx.hasPending) return tokenized;
    try {
      await ctx.flushOrThrow();
      return tokenized;
    } catch (err) {
      this.logger.warn(
        `Vault persist failed for session ${chatSessionId}; masking VAULT-tier instead of tokenising. ${err instanceof Error ? err.message : ''}`,
      );
      return this.detection.maskTokenizeTier(destroyed);
    }
  }
}

function parseIndex(token: string): number {
  const m = /_(\d+)\]$/.exec(token);
  return m ? parseInt(m[1]!, 10) : 0;
}
