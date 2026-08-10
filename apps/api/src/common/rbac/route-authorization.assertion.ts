import { Injectable, OnApplicationBootstrap, RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../decorators/public.decorator';
import { SELF_ONLY_KEY } from '../../decorators/self-only.decorator';
import {
  PERMISSION_KEY,
  RequiredPermission,
} from '../../decorators/require-permission.decorator';
import { PermissionCatalogService } from './permission-catalog.service';
import { AppLogger } from '../logger/app-logger';

/**
 * Boot-time backstop for PermissionGuard's default-deny.
 *
 * Walks every registered route and asserts two things:
 *
 *   1. Each route declares exactly one of @Public / @SelfOnly /
 *      @RequirePermission. An undeclared route is denied at runtime by
 *      the guard, so without this check it would ship and 403 silently in prod.
 *
 *   2. Every @RequirePermission references a key that actually exists in the
 *      permission matrix. A typo like `Agent:Updte` otherwise fails closed at
 *      runtime with no signal at build or deploy time.
 *
 * Both throw, which stops the app from starting. That is the point: an
 * authorization mistake should be impossible to deploy, not merely discouraged
 * in review. Keys present in the matrix but checked by no route are logged
 * rather than thrown — dead entries are untidy, not dangerous.
 */
@Injectable()
export class RouteAuthorizationAssertion implements OnApplicationBootstrap {
  private readonly log = new AppLogger(RouteAuthorizationAssertion.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly catalog: PermissionCatalogService,
  ) {}

  onApplicationBootstrap(): void {
    const undeclared: string[] = [];
    const unknownPermissions: string[] = [];
    const referenced = new Set<string>();
    let total = 0;

    for (const wrapper of this.discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;

      const prototype = Object.getPrototypeOf(instance);
      const basePath = this.reflector.get<string>(PATH_METADATA, metatype) ?? '';

      for (const methodName of this.scanner.getAllMethodNames(prototype)) {
        const handler = prototype[methodName];
        // Only real route handlers carry METHOD_METADATA.
        const httpMethod = Reflect.getMetadata(METHOD_METADATA, handler);
        if (httpMethod === undefined) continue;

        total++;
        const targets = [handler, metatype];
        const label = this.label(metatype.name, methodName, httpMethod, basePath, handler);

        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
        const isSelfOnly = this.reflector.getAllAndOverride<boolean>(SELF_ONLY_KEY, targets);
        const permission = this.reflector.getAllAndOverride<RequiredPermission>(
          PERMISSION_KEY,
          targets,
        );
        if (permission) {
          const key = `${permission.resource}:${permission.action}`;
          referenced.add(key);
          if (!this.catalog.getPermission(key)) {
            unknownPermissions.push(`${label} → ${key}`);
          }
          continue;
        }

        if (isPublic || isSelfOnly) continue;

        undeclared.push(label);
      }
    }

    if (undeclared.length > 0 || unknownPermissions.length > 0) {
      const parts: string[] = ['Authorization declaration check failed.'];
      if (undeclared.length > 0) {
        parts.push(
          `\n${undeclared.length} route(s) declare no authorization. Add @Public, @SelfOnly, or @RequirePermission:\n  ` +
            undeclared.join('\n  '),
        );
      }
      if (unknownPermissions.length > 0) {
        parts.push(
          `\n${unknownPermissions.length} route(s) require a permission with no row in the permissions table. ` +
            `Add it in a migration:\n  ` +
            unknownPermissions.join('\n  '),
        );
      }
      throw new Error(parts.join(''));
    }

    const orphaned = this.catalog
      .listPermissions()
      .map((p) => p.key)
      .filter((key) => !referenced.has(key));
    if (orphaned.length > 0) {
      this.log.debug(
        'onApplicationBootstrap',
        'permission keys defined but not checked by any route',
        { count: orphaned.length, keys: orphaned },
      );
    }

    this.log.info('onApplicationBootstrap', 'route authorization verified', {
      routes: total,
      permissionsInUse: referenced.size,
    });
  }

  private label(
    controller: string,
    methodName: string,
    httpMethod: number,
    basePath: string,
    handler: (...args: unknown[]) => unknown,
  ): string {
    const verb = RequestMethod[httpMethod] ?? String(httpMethod);
    const sub = this.reflector.get<string>(PATH_METADATA, handler) ?? '';
    const path = `/${[basePath, sub].filter((p) => p && p !== '/').join('/')}`;
    return `${verb} ${path}  (${controller}.${methodName})`;
  }
}
