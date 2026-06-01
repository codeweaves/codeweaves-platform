import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Why a heartbeat:
 *
 * Prisma's underlying `pg` driver opens connections lazily and drops idle
 * sockets after ~10s. Calling `$connect()` once at boot validates one socket
 * but doesn't keep the pool active.
 *
 * On a long-haul link (India dev machine → Supabase US-region) a cold
 * Postgres connection costs DNS + TCP + TLS + auth + first prepared statement
 * registration — measured ~400-800ms in this codebase. We saw turn 1 Prisma
 * ops at ~700ms each (3× turn 2's ~270ms each).
 *
 * Solution mirrors the OpenAI keepalive in AiSdkService: a lightweight
 * `SELECT 1` every 20s keeps the pool warm so the first user query lands on
 * an already-established socket with a populated prepared-statement cache.
 */
const HEARTBEAT_INTERVAL_MS = 20_000;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not configured');
    }

    const adapter = new PrismaPg({ connectionString });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();

    // Fire a couple of throwaway warm-up queries so the prepared-statement
    // cache is populated before the first real user request lands. The
    // queries themselves return nothing useful; the side effect is what we
    // want (warm connection, registered statements).
    try {
      await this.$queryRaw`SELECT 1`;
    } catch (err) {
      this.logger.warn(
        `Prisma warm-up query failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.heartbeatInterval = setInterval(() => {
      this.$queryRaw`SELECT 1`.catch((err) => {
        this.logger.warn(
          `Prisma heartbeat query failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, HEARTBEAT_INTERVAL_MS);
    // Don't keep the event loop alive just for the heartbeat — let shutdown
    // happen cleanly without us pinning the process.
    this.heartbeatInterval.unref?.();
    this.logger.log(
      `Prisma keep-alive heartbeat scheduled every ${HEARTBEAT_INTERVAL_MS}ms.`,
    );
  }

  async onModuleDestroy() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    await this.$disconnect();
  }
}
