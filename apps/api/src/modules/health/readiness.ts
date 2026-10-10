import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../../services/prisma.service";
import type { RedisService } from "../../common/redis/redis.service";
import { AppLogger } from "../../common/logger/app-logger";

/**
 * A dependency probe never waits longer than this. The platform health check
 * itself times out after a few seconds, so a hung probe must report, not hang.
 */
const CHECK_TIMEOUT_MS = 2_000;

export type CheckState = "ok" | "fail" | "degraded" | "disabled";

export interface DependencyCheck {
  state: CheckState;
  latencyMs: number;
  /** Coarse reason only (timeout | error). Details stay in server logs. */
  error?: "timeout" | "error";
}

export interface ReadinessReport {
  status: "ok" | "degraded" | "fail";
  timestamp: string;
  checks: {
    db: DependencyCheck;
    redis: DependencyCheck;
  };
}

export interface ReadinessDeps {
  prisma: PrismaService;
  redis: RedisService;
  config: ConfigService;
}

const log = new AppLogger("Readiness");

/**
 * Probe Postgres and Redis in parallel. Shared by `GET /health/ready` and the
 * ops console's system status, so both report the same thing.
 *
 * Postgres is required (`fail`). Redis is fail-open everywhere in the app
 * (cache, opt-in rate limits), so a Redis problem is `degraded`: the instance
 * still works, but someone should look.
 */
export async function probeReadiness(
  deps: ReadinessDeps,
): Promise<ReadinessReport> {
  const [db, redis] = await Promise.all([checkDb(deps), checkRedis(deps)]);
  const status: ReadinessReport["status"] =
    db.state === "fail"
      ? "fail"
      : redis.state === "degraded"
        ? "degraded"
        : "ok";
  return {
    status,
    timestamp: new Date().toISOString(),
    checks: { db, redis },
  };
}

async function checkDb({ prisma }: ReadinessDeps): Promise<DependencyCheck> {
  const start = performance.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS);
    return { state: "ok", latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    const error = err instanceof ProbeTimeoutError ? "timeout" : "error";
    log.error("checkDb", "readiness: database probe failed", err, { error });
    return {
      state: "fail",
      latencyMs: Math.round(performance.now() - start),
      error,
    };
  }
}

async function checkRedis({
  redis,
  config,
}: ReadinessDeps): Promise<DependencyCheck> {
  if (!config.get<string>("REDIS_URL")) {
    return { state: "disabled", latencyMs: 0 };
  }
  const start = performance.now();
  try {
    await withTimeout(redis.ping(), CHECK_TIMEOUT_MS);
    return { state: "ok", latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    const error = err instanceof ProbeTimeoutError ? "timeout" : "error";
    log.warn(
      "checkRedis",
      "readiness: redis probe failed (fail-open features degraded)",
      {
        error,
        message: err instanceof Error ? err.message : String(err),
      },
    );
    return {
      state: "degraded",
      latencyMs: Math.round(performance.now() - start),
      error,
    };
  }
}

class ProbeTimeoutError extends Error {
  constructor() {
    super("probe timeout");
    this.name = "ProbeTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProbeTimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}
