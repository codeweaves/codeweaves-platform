import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';

/**
 * Guards machine-to-machine "internal" endpoints (e.g. the classifier cron
 * trigger) with a shared secret sent in the `x-internal-secret` header.
 *
 * Used INSTEAD of a JWT: these endpoints are hit by an external scheduler
 * (Render Cron, GitHub Actions, cron-job.org, QStash…), not a logged-in user.
 * Pair it with `@Public()` so the JWT/user-sync guards step aside, then this
 * guard is the real auth gate.
 *
 * Fail-closed: if `INTERNAL_API_SECRET` is unset, every request is rejected —
 * we never silently leave an internal endpoint open.
 *
 * Comparison is constant-time to avoid leaking the secret via timing.
 */
@Injectable()
export class InternalSecretGuard implements CanActivate {
  private readonly logger = new Logger(InternalSecretGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.get<string>('INTERNAL_API_SECRET');
    if (!secret) {
      this.logger.error(
        'INTERNAL_API_SECRET is not set — rejecting internal request (fail-closed).',
      );
      throw new UnauthorizedException();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['x-internal-secret'];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!provided) {
      throw new UnauthorizedException();
    }

    const providedBuf = Buffer.from(provided);
    const secretBuf = Buffer.from(secret);
    if (
      providedBuf.length !== secretBuf.length ||
      !timingSafeEqual(providedBuf, secretBuf)
    ) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
