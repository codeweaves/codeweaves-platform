import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { isOrgScoped } from '../utils/tenant-filter';
import { AppLogger } from '../common/logger/app-logger';

/**
 * Guard that validates tenant context for ORG-scoped users.
 *
 * - PLATFORM scope passes through unconditionally.
 * - ORG scope MUST have a valid organizationId; throws 403 if not.
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

    // accessScope, NOT the deprecated `role` column. `PATCH /users/:id/scope`
    // changes scope and deliberately leaves `role` alone, so reading `role` here
    // would keep waving a demoted account through as platform staff.
    if (!isOrgScoped(user)) {
      return true;
    }

    if (!user.organizationId) {
      this.log.warn(
        'canActivate',
        'tenant check denied — client user has no organization',
        { accessScope: user.accessScope },
      );
      throw new ForbiddenException(
        'Client user must be associated with an organization',
      );
    }

    return true;
  }
}
