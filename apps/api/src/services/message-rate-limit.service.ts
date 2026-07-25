import { Injectable } from '@nestjs/common';
import { RateLimiterService } from '../common/redis/rate-limiter.service';
import { AppLogger } from '../common/logger/app-logger';
import type { Request } from 'express';

export interface MessageRateLimitResult {
  allowed: boolean;
  message?: string;
  retryAfterSeconds?: number;
}

const MINUTE_LIMIT = 10;
const MINUTE_WINDOW_MS = 60_000;
const HOUR_LIMIT = 100;
const HOUR_WINDOW_MS = 3_600_000;

// Coarse per-IP ceiling that a rotated `x-device-id` header CANNOT escape.
// Derived from the server-trusted client IP (never a client-supplied header),
// so it caps total spend per source even when the device sub-key churns. Set a
// few multiples above the per-device limit to tolerate several genuine visitors
// behind one NAT/proxy while still bounding an abuser. Env-tunable because the
// right headroom depends on the deployment's proxy topology (a shared CDN edge
// IP needs a higher ceiling than a direct connection). NaN-guarded so a bad env
// value falls back to the default rather than disabling the cap.
const IP_MINUTE_LIMIT = toPositiveInt(process.env.MSG_IP_MINUTE_LIMIT, 30);
const IP_HOUR_LIMIT = toPositiveInt(process.env.MSG_IP_HOUR_LIMIT, 300);

function toPositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const MSG_MINUTE_EXCEEDED =
  "You're sending messages too quickly. Please wait a moment.";
const MSG_HOUR_EXCEEDED =
  "You've sent too many messages. Please try again later.";

@Injectable()
export class MessageRateLimitService {
  private readonly log = new AppLogger(MessageRateLimitService.name);

  constructor(private readonly rateLimiterService: RateLimiterService) {}

  async checkMessageRateLimit(
    deviceId: string,
    agentPublicId: string,
    clientIp?: string,
  ): Promise<MessageRateLimitResult> {
    // Coarse per-IP ceiling first. This bucket is keyed on the server-derived
    // client IP (not the spoofable x-device-id), so an attacker rotating the
    // device header per request cannot mint fresh buckets to bypass the limit.
    // Checked before the device buckets, and from the higher (hour) threshold
    // down, so a phantom ZADD from a passing check lands in a tolerant bucket.
    if (clientIp && clientIp !== 'unknown') {
      const ipHourKey = `msg_rate_ip:${clientIp}:${agentPublicId}:hour`;
      const ipHourResult = await this.rateLimiterService.checkRateLimit(
        ipHourKey,
        IP_HOUR_LIMIT,
        HOUR_WINDOW_MS,
      );
      if (!ipHourResult.allowed) {
        this.log.warn(
          'checkMessageRateLimit',
          `per-IP hour rate limit exceeded for ip=${clientIp} agent=${agentPublicId}`,
        );
        return {
          allowed: false,
          message: MSG_HOUR_EXCEEDED,
          retryAfterSeconds: Math.ceil(ipHourResult.retryAfterMs / 1000),
        };
      }

      const ipMinuteKey = `msg_rate_ip:${clientIp}:${agentPublicId}:minute`;
      const ipMinuteResult = await this.rateLimiterService.checkRateLimit(
        ipMinuteKey,
        IP_MINUTE_LIMIT,
        MINUTE_WINDOW_MS,
      );
      if (!ipMinuteResult.allowed) {
        this.log.warn(
          'checkMessageRateLimit',
          `per-IP minute rate limit exceeded for ip=${clientIp} agent=${agentPublicId}`,
        );
        return {
          allowed: false,
          message: MSG_MINUTE_EXCEEDED,
          retryAfterSeconds: Math.ceil(ipMinuteResult.retryAfterMs / 1000),
        };
      }
    }

    // Check hour limit first — its higher threshold (100) tolerates a phantom
    // ZADD better than minute (10) if the subsequent check rejects the request.
    const hourKey = `msg_rate:${deviceId}:${agentPublicId}:hour`;
    const hourResult = await this.rateLimiterService.checkRateLimit(
      hourKey,
      HOUR_LIMIT,
      HOUR_WINDOW_MS,
    );

    if (!hourResult.allowed) {
      this.log.warn(
        'checkMessageRateLimit',
        `hour rate limit exceeded for device=${deviceId} agent=${agentPublicId}`,
      );
      return {
        allowed: false,
        message: MSG_HOUR_EXCEEDED,
        retryAfterSeconds: Math.ceil(hourResult.retryAfterMs / 1000),
      };
    }

    const minuteKey = `msg_rate:${deviceId}:${agentPublicId}:minute`;
    const minuteResult = await this.rateLimiterService.checkRateLimit(
      minuteKey,
      MINUTE_LIMIT,
      MINUTE_WINDOW_MS,
    );

    if (!minuteResult.allowed) {
      this.log.warn(
        'checkMessageRateLimit',
        `minute rate limit exceeded for device=${deviceId} agent=${agentPublicId}`,
      );
      return {
        allowed: false,
        message: MSG_MINUTE_EXCEEDED,
        retryAfterSeconds: Math.ceil(minuteResult.retryAfterMs / 1000),
      };
    }

    return { allowed: true };
  }

  getDeviceIdentifier(request: Request): string {
    const deviceIdHeader = request.headers['x-device-id'];
    if (deviceIdHeader) {
      return Array.isArray(deviceIdHeader) ? deviceIdHeader[0]! : deviceIdHeader;
    }

    if (request.ip) {
      return request.ip;
    }

    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      const first = Array.isArray(forwarded) ? forwarded[0]! : forwarded.split(',')[0]!;
      return first.trim();
    }

    return 'unknown';
  }

  /**
   * Server-trusted client IP for the coarse per-IP rate-limit ceiling. Uses ONLY
   * `request.ip`, which Express derives from the proxy chain per the app's
   * `trust proxy` setting. It deliberately does NOT fall back to a raw
   * `x-forwarded-for` header: that value is client-spoofable, and trusting it
   * here would reopen the very bypass this ceiling closes (an attacker would just
   * rotate the header to mint fresh IP buckets). When `request.ip` is absent we
   * return `'unknown'`, which SKIPS the per-IP ceiling for that request rather
   * than keying it on attacker-controlled input.
   *
   * NOTE: correctness depends on `trust proxy` matching the real deployment hop
   * count. Behind a CDN→platform-proxy chain (e.g. Cloudflare→Render), verify
   * `request.ip` resolves to the visitor and not a shared edge IP, otherwise the
   * per-IP limits below throttle unrelated visitors sharing that edge. The limits
   * are env-tunable for exactly this reason.
   */
  getClientIp(request: Request): string {
    return request.ip ?? 'unknown';
  }
}
