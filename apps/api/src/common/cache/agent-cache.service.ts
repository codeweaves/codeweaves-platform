import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Agent, AgentDataField, AgentKnowledge } from '@prisma/client';

import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../../services/prisma.service';

/**
 * Shape returned by `getAgentWithKnowledge()`. The agent's `aiConfig` JSONB is
 * kept untyped here — it's a `Prisma.JsonValue`, and callers re-parse it via
 * the `agentAiConfigSchema` (which is the single source of truth for that
 * field's shape and applies defaults).
 *
 * `dataFields` are included so the chat hot path can build the data-collection
 * prompt without an extra query. They're written rarely (editor save) and read
 * on every message — exactly what this cache is for.
 */
export interface CachedAgent extends Agent {
  knowledge: AgentKnowledge | null;
  dataFields: AgentDataField[];
}

/** Default TTL (seconds). Overridable via AGENT_CACHE_TTL_SECONDS env. */
const DEFAULT_TTL_SECONDS = 3600;
const CACHE_PREFIX = 'agent:cache:';

/**
 * In-process L1 TTL (ms). Overridable via AGENT_CACHE_L1_TTL_MS env
 * (set to 0 to disable the L1 entirely).
 *
 * Why an L1 at all: the "Redis ~1-3ms" assumption is false in production —
 * Upstash over TLS measured p50 199ms / p95 1.3s per chat turn on the
 * `knowledge.load` step (chat_traces, 60 days). Agent config changes only on
 * editor saves, so a 45s in-process memo eliminates that network hop from
 * virtually every turn. Cross-pod staleness is bounded by this TTL: another
 * pod may serve a ≤45s-stale agent config after a save. `invalidate()` clears
 * the local pod's L1 immediately.
 */
const DEFAULT_L1_TTL_MS = 45_000;
/** Max L1 entries (~a few KB each). Oldest-inserted evicted beyond this. */
const L1_MAX_ENTRIES = 500;

/**
 * AgentCacheService: Redis-backed read-through cache for agent rows + their
 * 1:1 relations (currently: knowledge). Invalidated explicitly on every write
 * path; the TTL is a safety net, not the primary expiry mechanism.
 *
 * Why cache agent+knowledge together:
 *   - Chat hot path reads them as a unit on every message
 *   - Neither changes between messages of the same session
 *   - Single cache entry = single get/set, no per-field juggling
 *
 * Failure mode (fail-open):
 *   - Any Redis error → log a warning, fall through to Postgres
 *   - Serialisation / deserialisation errors → same: fall through
 *   - Chat keeps working even if Redis is completely down
 *
 * Cross-pod consistency:
 *   - Redis is shared across API instances, so invalidation from pod A is
 *     seen by pod B on the next read
 *   - No distributed cache coordination code needed
 *
 * NOT responsible for:
 *   - Triggering invalidation on agent writes — each write-path service
 *     (AgentsService.update, AgentKnowledgeService.set/remove, etc.) calls
 *     `invalidate()` after the DB write commits
 *   - Caching partial views (per-field selects) — if a caller needs a subset,
 *     they can call this and pick out the fields they need
 */
@Injectable()
export class AgentCacheService {
  private readonly logger = new Logger(AgentCacheService.name);
  private readonly ttlSeconds: number;
  private readonly l1TtlMs: number;
  private readonly l1 = new Map<
    string,
    { value: CachedAgent; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    const raw = this.config.get<string>('AGENT_CACHE_TTL_SECONDS');
    const parsed = raw ? parseInt(raw, 10) : NaN;
    this.ttlSeconds =
      Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_SECONDS;
    const l1Raw = this.config.get<string>('AGENT_CACHE_L1_TTL_MS');
    const l1Parsed = l1Raw ? parseInt(l1Raw, 10) : NaN;
    this.l1TtlMs =
      Number.isFinite(l1Parsed) && l1Parsed >= 0 ? l1Parsed : DEFAULT_L1_TTL_MS;
  }

  /**
   * Read-through fetch. Cache hit → return cached. Miss → Postgres, populate,
   * return. If agent doesn't exist at all (deleted / never created), returns
   * null — does NOT cache negative results (so a creation is visible instantly).
   */
  async getAgentWithKnowledge(agentId: string): Promise<CachedAgent | null> {
    const key = CACHE_PREFIX + agentId;

    // 0. In-process L1 — no network at all. This is what the chat hot path
    // hits on virtually every turn (agent config only changes on editor saves).
    const l1Hit = this.l1.get(key);
    if (l1Hit && l1Hit.expiresAt > Date.now()) {
      return l1Hit.value;
    }
    if (l1Hit) this.l1.delete(key);

    // 1. Try Redis (cross-pod layer)
    try {
      const cached = await this.redis.get(key);
      if (cached) {
        const parsed = JSON.parse(cached, reviveDates) as CachedAgent;
        this.setL1(key, parsed);
        return parsed;
      }
    } catch (err) {
      this.logger.warn(
        `Redis GET failed for ${key} — falling through to DB. ${err instanceof Error ? err.message : ''}`,
      );
    }

    // 2. Cache miss or Redis down — hit Postgres
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, deletedAt: null },
      include: {
        knowledge: true,
        dataFields: { orderBy: { order: 'asc' } },
      },
    });
    if (!agent) return null;

    // 3. Populate caches (Redis fire-and-forget — don't block the read)
    this.setL1(key, agent);
    void this.setCache(key, agent);

    return agent;
  }

  /** Insert into the L1 memo, evicting the oldest entry beyond the cap. */
  private setL1(key: string, value: CachedAgent): void {
    if (this.l1TtlMs === 0) return; // env opt-out
    if (this.l1.size >= L1_MAX_ENTRIES && !this.l1.has(key)) {
      const oldestKey = this.l1.keys().next().value;
      if (oldestKey) this.l1.delete(oldestKey);
    }
    this.l1.set(key, { value, expiresAt: Date.now() + this.l1TtlMs });
  }

  /**
   * Explicitly invalidate the cached entry for an agent. Call this from
   * every write path that modifies Agent or any of its cached relations.
   *
   * Always safe to call — no-op if the key doesn't exist.
   */
  async invalidate(agentId: string): Promise<void> {
    // Local pod sees the write instantly; other pods converge within the L1
    // TTL (their next Redis read misses because we delete the key below).
    this.l1.delete(CACHE_PREFIX + agentId);
    try {
      await this.redis.del(CACHE_PREFIX + agentId);
    } catch (err) {
      this.logger.warn(
        `Redis DEL failed for agent ${agentId} — stale cache may persist up to TTL (${this.ttlSeconds}s). ${err instanceof Error ? err.message : ''}`,
      );
    }
  }

  private async setCache(key: string, value: CachedAgent): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), this.ttlSeconds);
    } catch (err) {
      this.logger.warn(
        `Redis SET failed for ${key} — cache disabled for this read. ${err instanceof Error ? err.message : ''}`,
      );
    }
  }
}

/**
 * JSON.parse reviver: Date fields on Prisma rows serialise as ISO strings and
 * deserialise as strings (not Dates) without help. Revive fields we know are
 * dates. Keeping the list explicit beats a regex for safety.
 */
const DATE_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'deletedAt',
  'lastMessageAt',
]);
function reviveDates(key: string, value: unknown): unknown {
  if (
    DATE_FIELDS.has(key) &&
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(value)
  ) {
    return new Date(value);
  }
  return value;
}
