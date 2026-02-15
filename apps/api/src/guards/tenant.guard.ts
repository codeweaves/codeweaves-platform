import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Role } from '@prisma/client';

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
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return false;
    }

    if (user.role === Role.SUPER_ADMIN || user.role === Role.ADMIN) {
      return true;
    }

    if (!user.organizationId) {
      throw new ForbiddenException(
        'Client user must be associated with an organization',
      );
    }

    return true;
  }
}
