import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { RateLimiterService } from '../common/redis/rate-limiter.service';
import {
  RateLimitConfig,
  DEFAULT_API_RATE_LIMIT,
  DEFAULT_PUBLIC_RATE_LIMIT,
} from '../common/redis/rate-limiter.types';
import { SKIP_RATE_LIMIT_KEY, RATE_LIMIT_KEY } from '../decorators/rate-limit.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimiterService: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Check @SkipRateLimit()
    const skipRateLimit = this.reflector.getAllAndOverride<boolean>(
      SKIP_RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skipRateLimit) {
      return true;
    }

    // 2. Check @RateLimit() for custom config
    const customConfig = this.reflector.getAllAndOverride<RateLimitConfig>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 3. Check @Public() to determine keying strategy
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // 4. Determine config
    const user = (request as Request & { user?: { id?: string } }).user;
    const isAuthenticated = !isPublic && user?.id;

    const config: RateLimitConfig = customConfig
      ? customConfig
      : isAuthenticated
        ? DEFAULT_API_RATE_LIMIT
        : DEFAULT_PUBLIC_RATE_LIMIT;

    // 5. Build rate limit key
    const endpoint = `${request.method}:${request.route?.path ?? request.path}`;
    const key = isAuthenticated
      ? `user:${user!.id}:${endpoint}`
      : `ip:${this.getClientIp(request)}:${endpoint}`;

    // 6. Check rate limit
    const result = await this.rateLimiterService.checkRateLimit(
      key,
      config.limit,
      config.windowMs,
    );

    // 7. Set response headers
    const resetSeconds = Math.ceil(result.resetMs / 1000);
    response.setHeader('X-RateLimit-Limit', config.limit);
    response.setHeader('X-RateLimit-Remaining', result.remaining);
    response.setHeader('X-RateLimit-Reset', resetSeconds);

    // 8. If not allowed, throw 429
    if (!result.allowed) {
      const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);
      response.setHeader('Retry-After', retryAfterSeconds);
      this.logger.warn(`Rate limit exceeded for key: rate_limit:${key}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too Many Requests',
          retryAfter: retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private getClientIp(request: Request): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
      const ip = first?.trim() || request.ip;
      if (ip) return ip;
    } else if (request.ip) {
      return request.ip;
    }
    this.logger.warn(
      'Could not determine client IP — falling back to 0.0.0.0 (shared rate limit bucket)',
    );
    return '0.0.0.0';
  }
}
