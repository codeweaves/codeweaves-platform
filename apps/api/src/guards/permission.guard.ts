import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSION_KEY,
  RequiredPermission,
} from '../decorators/require-permission.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SELF_ONLY_KEY } from '../decorators/self-only.decorator';
import { PermissionCatalogService } from '../common/rbac/permission-catalog.service';
import { AppLogger } from '../common/logger/app-logger';

/**
 * Global authorization guard (registered as APP_GUARD in AppModule).
 *
 * Every route must declare its intent with exactly one of `@Public`,
 * `@SelfOnly`, or `@RequirePermission`. A route that declares nothing is DENIED
 * — the previous per-controller guard defaulted to allow, so a controller that
 * forgot `@UseGuards(RolesGuard)` silently served every authenticated user.
 *
 * Default-deny is only safe because RouteAuthorizationAssertion refuses to start
 * the app when any route is undeclared, so such a route can never reach
 * production and 403 in the dark.
 *
 * Permissions come from the user's ROLE SET, resolved through the in-memory
 * catalog: the union of every permission granted by every role held. Overlapping
 * roles dedupe, which is what makes the model additive.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly log = new AppLogger(PermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly catalog: PermissionCatalogService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    // 1. Public routes carry no authenticated user at all.
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    // 2. Self-scoped routes read the caller's own record via `user.id`.
    if (this.reflector.getAllAndOverride<boolean>(SELF_ONLY_KEY, targets)) {
      return true;
    }

    // 3. Permission-based check (the target model).
    const requiredPermission =
      this.reflector.getAllAndOverride<RequiredPermission>(
        PERMISSION_KEY,
        targets,
      );
    if (requiredPermission) {
      return this.checkPermission(context, requiredPermission);
    }

    // 4. Nothing declared. Deny loudly rather than serving the request.
    const handler = `${context.getClass().name}.${context.getHandler().name}`;
    this.log.error(
      'canActivate',
      'route has no authorization declaration — denying',
      undefined,
      { handler },
    );
    throw new ForbiddenException('Forbidden: route declares no authorization');
  }

  private checkPermission(
    context: ExecutionContext,
    permission: RequiredPermission,
  ): boolean {
    const user = context.switchToHttp().getRequest().user;
    const key = `${permission.resource}:${permission.action}`;

    if (!user) {
      this.log.warn('checkPermission', 'permission denied — no user', { permission: key });
      throw new ForbiddenException(`Forbidden: requires [${key}] permission`);
    }

    const granted = this.catalog.resolvePermissions(user.roleKeys ?? []);

    if (!granted.has(key)) {
      this.log.warn('checkPermission', 'permission denied', {
        userId: user.id,
        roleKeys: user.roleKeys ?? [],
        permission: key,
      });
      throw new ForbiddenException(`Forbidden: requires [${key}] permission`);
    }

    return true;
  }
}
