import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Agent, AgentKnowledge } from '@prisma/client';

import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../../services/prisma.service';

/**
 * Shape returned by `getAgentWithKnowledge()`. The agent's `aiConfig` JSONB is
 * kept untyped here — it's a `Prisma.JsonValue`, and callers re-parse it via
 * the `agentAiConfigSchema` (which is the single source of truth for that
 * field's shape and applies defaults).
 */
export interface CachedAgent extends Agent {
  knowledge: AgentKnowledge | null;
}

/** Default TTL (seconds). Overridable via AGENT_CACHE_TTL_SECONDS env. */
const DEFAULT_TTL_SECONDS = 3600;
const CACHE_PREFIX = 'agent:cache:';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    const raw = this.config.get<string>('AGENT_CACHE_TTL_SECONDS');
    const parsed = raw ? parseInt(raw, 10) : NaN;
    this.ttlSeconds =
      Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_SECONDS;
  }

  /**
   * Read-through fetch. Cache hit → return cached. Miss → Postgres, populate,
   * return. If agent doesn't exist at all (deleted / never created), returns
   * null — does NOT cache negative results (so a creation is visible instantly).
   */
  async getAgentWithKnowledge(agentId: string): Promise<CachedAgent | null> {
    const key = CACHE_PREFIX + agentId;

    // 1. Try cache
    try {
      const cached = await this.redis.get(key);
      if (cached) {
        const parsed = JSON.parse(cached, reviveDates) as CachedAgent;
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
      include: { knowledge: true },
    });
    if (!agent) return null;

    // 3. Populate cache (fire-and-forget — don't block the read on Redis)
    void this.setCache(key, agent);

    return agent;
  }

  /**
   * Explicitly invalidate the cached entry for an agent. Call this from
   * every write path that modifies Agent or any of its cached relations.
   *
   * Always safe to call — no-op if the key doesn't exist.
   */
  async invalidate(agentId: string): Promise<void> {
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
