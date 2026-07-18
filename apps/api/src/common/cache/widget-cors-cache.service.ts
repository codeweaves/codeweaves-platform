import { Injectable } from '@nestjs/common';
import { AppLogger } from '../logger/app-logger';

/**
 * In-memory per-replica cache of `Agent.allowedDomains` keyed by both the
 * agent's `publicId` (used by the widget config endpoint URL) and its `id`
 * UUID (used by chat/voice POST bodies). One agent → two keys point at the
 * same domain list.
 *
 * Why a dedicated service instead of inlining in `WidgetCorsMiddleware`:
 *   - The middleware is a request-path read; `AgentsService.update` is a
 *     write path. Both need to touch the same cache. Extracting lets us
 *     inject from either side without circular imports.
 *   - Mirrors the pattern of [[AgentCacheService]] (Redis-backed cache for
 *     the orchestrator hot path), keeping the codebase consistent.
 *
 * Per-replica only — there's intentionally NO cross-pod invalidation here.
 * Each API replica holds its own copy. On a domain update:
 *   - The replica that handles the dashboard PUT busts its own entry
 *     synchronously (zero-stale on the editing user's next widget request).
 *   - Other replicas serve the stale list until the TTL expires (10 min).
 *
 * That trade-off is intentional: a Redis round-trip on every CORS check is
 * expensive (we're at 200-400ms saved per widget request by avoiding it),
 * and CORS edits are rare. If we ever need true cross-pod invalidation, the
 * cleanest swap is wiring this through Redis with a pub/sub channel — same
 * `set/invalidate` API, no caller changes.
 */
@Injectable()
export class WidgetCorsCacheService {
  private readonly log = new AppLogger(WidgetCorsCacheService.name);
  private readonly cache = new Map<
    string,
    { domains: string[]; expiresAt: number }
  >();

  /** Cache TTL — 10 minutes. CORS edits are rare, this is a safety net. */
  static readonly TTL_MS = 10 * 60_000;

  /** Read a cached entry. Returns `null` on miss or after TTL expiry. */
  get(key: string): string[] | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return entry.domains;
  }

  /**
   * Populate the cache. The same `domains` array is stored under BOTH the
   * publicId and UUID keys when both are supplied — saves a second DB
   * round-trip when a single agent is requested via either identifier
   * during the TTL window.
   */
  set(keys: { publicId?: string | null; id?: string | null }, domains: string[]): void {
    const expiresAt = Date.now() + WidgetCorsCacheService.TTL_MS;
    if (keys.publicId) this.cache.set(keys.publicId, { domains, expiresAt });
    if (keys.id) this.cache.set(keys.id, { domains, expiresAt });
  }

  /**
   * Delete the cached entries for an agent. Safe to call with either
   * identifier missing — we just skip the missing key. Called by
   * `AgentsService.update` after an allowedDomains change so the next
   * widget request on this replica reads fresh data.
   */
  invalidate(keys: { publicId?: string | null; id?: string | null }): void {
    let removed = 0;
    if (keys.publicId && this.cache.delete(keys.publicId)) removed++;
    if (keys.id && this.cache.delete(keys.id)) removed++;
    if (removed > 0) {
      this.log.debug(
        'invalidate',
        `Widget CORS cache invalidated for agent (publicId=${keys.publicId ?? '-'} id=${keys.id ?? '-'}, removed ${removed} key(s))`,
      );
    }
  }

  /** Test-only: clear the entire cache. */
  clearAll(): void {
    this.cache.clear();
  }
}
