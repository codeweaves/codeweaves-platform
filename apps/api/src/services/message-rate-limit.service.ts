import { Injectable, Logger } from '@nestjs/common';
import { RateLimiterService } from '../common/redis/rate-limiter.service';
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

const MSG_MINUTE_EXCEEDED =
  "You're sending messages too quickly. Please wait a moment.";
const MSG_HOUR_EXCEEDED =
  "You've sent too many messages. Please try again later.";

@Injectable()
export class MessageRateLimitService {
  private readonly logger = new Logger(MessageRateLimitService.name);

  constructor(private readonly rateLimiterService: RateLimiterService) {}

  async checkMessageRateLimit(
    deviceId: string,
    agentPublicId: string,
  ): Promise<MessageRateLimitResult> {
    // Check hour limit first — its higher threshold (100) tolerates a phantom
    // ZADD better than minute (10) if the subsequent check rejects the request.
    const hourKey = `msg_rate:${deviceId}:${agentPublicId}:hour`;
    const hourResult = await this.rateLimiterService.checkRateLimit(
      hourKey,
      HOUR_LIMIT,
      HOUR_WINDOW_MS,
    );

    if (!hourResult.allowed) {
      this.logger.warn(
        `Hour rate limit exceeded for device=${deviceId} agent=${agentPublicId}`,
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
      this.logger.warn(
        `Minute rate limit exceeded for device=${deviceId} agent=${agentPublicId}`,
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
}
