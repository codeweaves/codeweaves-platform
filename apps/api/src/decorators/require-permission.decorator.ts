import { SetMetadata } from '@nestjs/common';
import { Resource, Action } from '../common/rbac/rbac.types';

export const PERMISSION_KEY = 'permission';

export interface RequiredPermission {
  resource: Resource;
  action: Action;
}

export const RequirePermission = (resource: Resource, action: Action) =>
  SetMetadata(PERMISSION_KEY, { resource, action });
