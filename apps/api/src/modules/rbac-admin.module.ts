import { Module } from '@nestjs/common';
import { RbacController } from '../controllers/rbac/rbac.controller';
import { UserRolesService } from '../services/user-roles.service';
import { PrismaModule } from './prisma.module';
import { TracerModule } from '../common/tracer/tracer.module';
import { UserSyncGuard } from '../guards/user-sync.guard';
import { UsersModule } from './users.module';

/**
 * Role administration surface.
 *
 * UserSyncGuard is provided here so UserRolesService can call `evict()` on the
 * target of a role change. Nest builds this instance separately from the
 * APP_GUARD one, which is exactly why that guard's cache is static — otherwise
 * eviction would clear a map the request path never reads.
 */
@Module({
  imports: [PrismaModule, TracerModule, UsersModule],
  controllers: [RbacController],
  providers: [UserRolesService, UserSyncGuard],
  exports: [UserRolesService],
})
export class RbacAdminModule {}
