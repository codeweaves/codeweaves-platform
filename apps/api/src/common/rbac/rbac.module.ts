import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { PermissionCatalogService } from './permission-catalog.service';
import { RouteAuthorizationAssertion } from './route-authorization.assertion';

@Global()
@Module({
  // DiscoveryModule gives RouteAuthorizationAssertion the controller registry it
  // walks at boot to verify every route declares its authorization.
  imports: [DiscoveryModule],
  // PermissionCatalogService loads in onModuleInit, which Nest runs before the
  // onApplicationBootstrap that RouteAuthorizationAssertion hooks — so the
  // catalog is populated by the time the assertion validates keys against it.
  providers: [PermissionCatalogService, RouteAuthorizationAssertion],
  exports: [PermissionCatalogService],
})
export class RbacModule {}
