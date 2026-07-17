import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { AppLogger } from '../common/logger/app-logger';

/**
 * Guard that validates tenant context for CLIENT users.
 *
 * - ADMIN / SUPER_ADMIN pass through unconditionally.
 * - CLIENT users MUST have a valid organizationId; throws 403 if not.
 *
 * Apply with @UseGuards(TenantGuard) on controllers/routes
 * that serve tenant-scoped data.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  private readonly log = new AppLogger(TenantGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      this.log.warn('canActivate', 'tenant check denied — no authenticated user');
      return false;
    }

    if (user.role === Role.SUPER_ADMIN || user.role === Role.ADMIN) {
      return true;
    }

    if (!user.organizationId) {
      this.log.warn(
        'canActivate',
        'tenant check denied — client user has no organization',
        { role: user.role },
      );
      throw new ForbiddenException(
        'Client user must be associated with an organization',
      );
    }

    return true;
  }
}
