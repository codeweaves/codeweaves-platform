import { INestApplication, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Socket.io adapter that enables cross-instance fan-out via Redis ONLY when
 * `REDIS_URL` is set — the same single switch the rest of the app uses.
 *
 *   • Single instance / no REDIS_URL  → default in-memory adapter (ZERO Redis).
 *   • Multiple instances               → set REDIS_URL and restart; fan-out turns
 *                                        on with NO code change, ever.
 *
 * Fail-open (mirrors RedisService): if Redis is set but unreachable, fall back
 * to in-memory rather than crash boot. The realtime layer is best-effort.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplication,
    private readonly redisUrl?: string,
  ) {
    super(app);
    // Attach Socket.io to the SAME Node HTTP server the app listens on. In this
    // setup `super(app)` didn't capture it, so set it explicitly (otherwise
    // createIOServer tries `new Server(<not-an-http-server>)` → "server.listeners
    // is not a function").
    const httpServer = app.getHttpServer();
    if (httpServer) {
      (this as unknown as { httpServer: unknown }).httpServer = httpServer;
    }
  }

  /** Call before `useWebSocketAdapter`. No-op (in-memory) when REDIS_URL unset. */
  async connectToRedis(): Promise<void> {
    if (!this.redisUrl) {
      this.logger.log(
        'REDIS_URL not set — Socket.io using in-memory adapter (single instance).',
      );
      return;
    }
    const pubClient = new Redis(this.redisUrl, {
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    const subClient = pubClient.duplicate();
    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);
      this.adapterConstructor = createAdapter(pubClient, subClient);
      this.logger.log(
        'Socket.io Redis adapter connected — cross-instance fan-out enabled.',
      );
    } catch (err) {
      this.logger.warn(
        `Socket.io Redis adapter unavailable — falling back to in-memory fan-out. ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    // Pass options through untouched (CORS is set on the @WebSocketGateway).
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
