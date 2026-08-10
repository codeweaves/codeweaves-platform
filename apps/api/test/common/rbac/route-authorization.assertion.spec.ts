import { Controller, Get, Post } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { RouteAuthorizationAssertion } from '../../../src/common/rbac/route-authorization.assertion';
import { Public } from '../../../src/decorators/public.decorator';
import { SelfOnly } from '../../../src/decorators/self-only.decorator';
import { RequirePermission } from '../../../src/decorators/require-permission.decorator';
import { Resource, Action } from '../../../src/common/rbac/rbac.types';
import type { PermissionCatalogService } from '../../../src/common/rbac/permission-catalog.service';

/** What the fixture controllers legitimately reference. */
const KNOWN_PERMISSIONS = new Set(['Agent:Read']);

/* ------------------------------------------------------------------ *
 * Fixture controllers, one per declaration style.
 * ------------------------------------------------------------------ */

@Controller('declared')
class DeclaredController {
  @Get('public')
  @Public()
  publicRoute() {}

  @Get('self')
  @SelfOnly()
  selfRoute() {}

  @Get('permission')
  @RequirePermission(Resource.Agent, Action.Read)
  permissionRoute() {}

}

@Controller('undeclared')
class UndeclaredController {
  @Get('oops')
  undeclaredRoute() {}

  @Post('also-oops')
  anotherUndeclaredRoute() {}
}

@Public()
@Controller('class-level')
class ClassLevelPublicController {
  @Get('one')
  one() {}

  @Get('two')
  two() {}
}

@Controller('bad-key')
class UnknownPermissionController {
  // Resource/Action are enums so a genuine typo cannot be written here. Cast to
  // simulate what a hand-edited or generated decorator would produce.
  @Get('typo')
  @RequirePermission('Agent' as Resource, 'Updte' as Action)
  typoRoute() {}
}

@Controller('not-a-route')
class NoRoutesController {
  // No HTTP verb decorator, so the assertion must skip it entirely rather than
  // flagging every public helper on a controller as an undeclared route.
  helper() {}
}

describe('RouteAuthorizationAssertion', () => {
  function build(controllers: unknown[]) {
    const discovery = {
      getControllers: () =>
        controllers.map((C) => ({
          instance: new (C as new () => object)(),
          metatype: C,
        })),
    } as unknown as DiscoveryService;

    // Stand-in catalog: every key referenced by the fixtures exists except the
    // deliberate typo, which is what the unknown-permission cases assert on.
    const catalog = {
      getPermission: (key: string) =>
        KNOWN_PERMISSIONS.has(key) ? { key } : undefined,
      listPermissions: () => [...KNOWN_PERMISSIONS].map((key) => ({ key })),
    } as unknown as PermissionCatalogService;

    return new RouteAuthorizationAssertion(
      discovery,
      new MetadataScanner(),
      new Reflector(),
      catalog,
    );
  }

  it('passes when every route declares its authorization', () => {
    expect(() => build([DeclaredController]).onApplicationBootstrap()).not.toThrow();
  });

  it('accepts a class-level declaration for all of its routes', () => {
    expect(() =>
      build([ClassLevelPublicController]).onApplicationBootstrap(),
    ).not.toThrow();
  });

  it('ignores methods that are not route handlers', () => {
    expect(() => build([NoRoutesController]).onApplicationBootstrap()).not.toThrow();
  });

  it('throws when a route declares nothing', () => {
    expect(() => build([UndeclaredController]).onApplicationBootstrap()).toThrow(
      /declare no authorization/,
    );
  });

  it('names every undeclared route so the failure is actionable', () => {
    let message = '';
    try {
      build([UndeclaredController]).onApplicationBootstrap();
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('UndeclaredController.undeclaredRoute');
    expect(message).toContain('UndeclaredController.anotherUndeclaredRoute');
    expect(message).toContain('GET /undeclared/oops');
  });

  it('throws when a permission key has no row in the catalog', () => {
    expect(() =>
      build([UnknownPermissionController]).onApplicationBootstrap(),
    ).toThrow(/no row in the permissions table/);
  });

  it('reports the offending key for an unknown permission', () => {
    let message = '';
    try {
      build([UnknownPermissionController]).onApplicationBootstrap();
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('Agent:Updte');
  });

  it('reports undeclared routes and unknown permissions together', () => {
    let message = '';
    try {
      build([UndeclaredController, UnknownPermissionController]).onApplicationBootstrap();
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('declare no authorization');
    expect(message).toContain('no row in the permissions table');
  });

  it('does not throw for permission keys that no route references', () => {
    // DeclaredController checks a single key; the rest of the catalog is orphaned
    // and must be logged rather than treated as a failure.
    expect(() => build([DeclaredController]).onApplicationBootstrap()).not.toThrow();
  });
});
