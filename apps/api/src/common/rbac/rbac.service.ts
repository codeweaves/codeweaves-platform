import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Resource, Action, PermissionKey } from './rbac.types';
import { hasPermission, getPermissionsForRole } from './permissions';

@Injectable()
export class RbacService {
  checkPermission(role: Role, resource: Resource, action: Action): boolean {
    return hasPermission(role, resource, action);
  }

  getPermissionsForRole(role: Role): readonly PermissionKey[] {
    return getPermissionsForRole(role);
  }
}
