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

@Injectable()
export class RolesGuard implements CanActivate {
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
      return false;
    }

    return requiredRoles.includes(user.role);
  }

  private checkPermission(
    context: ExecutionContext,
    permission: RequiredPermission,
  ): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.role) {
      throw new ForbiddenException(
        `Forbidden: requires [${permission.resource}:${permission.action}] permission`,
      );
    }

    // SUPER_ADMIN bypasses the matrix
    if (user.role === Role.SUPER_ADMIN) {
      return true;
    }

    const key: PermissionKey = `${permission.resource}:${permission.action}`;
    const allowedRoles = PERMISSION_MATRIX[key];

    if (!allowedRoles || !allowedRoles.includes(user.role)) {
      throw new ForbiddenException(
        `Forbidden: requires [${permission.resource}:${permission.action}] permission`,
      );
    }

    return true;
  }
}
