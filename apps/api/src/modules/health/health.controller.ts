import { Controller, Get, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import type { Response } from "express";
import { Public } from "../../decorators/public.decorator";
import { SkipRateLimit } from "../../decorators/rate-limit.decorator";
import { PrismaService } from "../../services/prisma.service";
import { RedisService } from "../../common/redis/redis.service";
import { probeReadiness, type ReadinessReport } from "./readiness";

export type { CheckState, DependencyCheck, ReadinessReport } from "./readiness";

/**
 * The commit this instance is running, so a deploy can be verified rather than
 * assumed. Render sets RENDER_GIT_COMMIT on its own; anywhere else (Cloud Run)
 * must pass GIT_COMMIT in at build time.
 *
 * Without this, a pipeline that polls /health after triggering a deploy gets
 * "ok" straight away from the OLD instance, which is still serving while the new
 * one builds. That makes the check meaningless.
 */
const DEPLOYED_COMMIT =
  process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "unknown";

@ApiTags("Health")
@SkipRateLimit()
@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /** Liveness: is the process up. No I/O, so it never flaps on a dependency. */
  @Public()
  @Get()
  @ApiOperation({ summary: "Liveness health check" })
  @ApiResponse({ status: 200, description: "Service is alive" })
  getHealth(): {
    status: string;
    timestamp: string;
    version: string;
    commit: string;
    uptime: number;
  } {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || "0.0.0",
      commit: DEPLOYED_COMMIT,
      uptime: process.uptime(),
    };
  }

  /**
   * Readiness: can this instance serve traffic. Postgres is required (503 when
   * unreachable). Redis is fail-open everywhere in the app (cache, opt-in rate
   * limits), so a Redis problem reports `degraded` with a 200: the instance
   * still works, but someone should look. Point uptime monitors and the
   * platform health check here, not at the liveness route.
   */
  @Public()
  @Get("ready")
  @ApiOperation({
    summary: "Readiness: Postgres + Redis probes with 2s timeouts",
  })
  @ApiResponse({
    status: 200,
    description: "Ready (or degraded: Redis down, DB fine)",
  })
  @ApiResponse({ status: 503, description: "Not ready: database unreachable" })
  async getReadiness(
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReadinessReport> {
    const report = await probeReadiness({
      prisma: this.prisma,
      redis: this.redis,
      config: this.config,
    });
    if (report.status === "fail") res.status(503);
    return report;
  }
}
