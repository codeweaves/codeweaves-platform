import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import {
  PERMISSION_KEY,
  RequiredPermission,
} from '../decorators/require-permission.decorator';
import { PERMISSION_MATRIX } from '../common/rbac/permissions';
import { PermissionKey } from '../common/rbac/rbac.types';
import { AppLogger } from '../common/logger/app-logger';

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly log = new AppLogger(RolesGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. Check @RequirePermission first
    const requiredPermission =
      this.reflector.getAllAndOverride<RequiredPermission>(PERMISSION_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

    if (requiredPermission) {
      return this.checkPermission(context, requiredPermission);
    }

    // 2. Fall back to @Roles check
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.role) {
      this.log.warn('canActivate', 'role check denied — no role on user', {
        required: requiredRoles,
      });
      return false;
    }

    const allowed = requiredRoles.includes(user.role);
    if (!allowed) {
      this.log.warn('canActivate', 'role check denied', {
        role: user.role,
        required: requiredRoles,
      });
    }
    return allowed;
  }

  private checkPermission(
    context: ExecutionContext,
    permission: RequiredPermission,
  ): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    const key: PermissionKey = `${permission.resource}:${permission.action}`;

    if (!user?.role) {
      this.log.warn('checkPermission', 'permission denied — no role on user', {
        permission: key,
      });
      throw new ForbiddenException(
        `Forbidden: requires [${permission.resource}:${permission.action}] permission`,
      );
    }

    // SUPER_ADMIN bypasses the matrix
    if (user.role === Role.SUPER_ADMIN) {
      return true;
    }

    const allowedRoles = PERMISSION_MATRIX[key];

    if (!allowedRoles || !allowedRoles.includes(user.role)) {
      this.log.warn('checkPermission', 'permission denied', {
        role: user.role,
        permission: key,
      });
      throw new ForbiddenException(
        `Forbidden: requires [${permission.resource}:${permission.action}] permission`,
      );
    }

    return true;
  }
}
