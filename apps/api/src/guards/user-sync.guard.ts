import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessScope, Role } from '@prisma/client';
import { UsersService } from '../services/users.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppLogger } from '../common/logger/app-logger';

interface CachedUserData {
  id: string;
  role: Role;
  /** Which rows this account may touch. See the AccessScope enum. */
  accessScope: AccessScope;
  /** Role keys held. PermissionGuard resolves these to a permission set. */
  roleKeys: string[];
  organizationId: string | null;
  organization: { id: string; name: string; slug: string } | null;
}

@Injectable()
export class UserSyncGuard implements CanActivate {
  private readonly log = new AppLogger(UserSyncGuard.name);
  /**
   * STATIC on purpose. Nest builds the APP_GUARD instance separately from any
   * instance injected elsewhere, so a per-instance Map would mean the role
   * endpoint evicting a cache the request path never reads — the revocation
   * would silently take the full TTL to apply. A process-wide map is also the
   * correct scope for this data.
   */
  private static readonly userCache = new Map<
    string,
    { data: CachedUserData; expiresAt: number }
  >();
  static readonly CACHE_TTL_MS = 60_000; // 60 seconds

  constructor(
    private usersService: UsersService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const jwtUser = request.user;

    if (!jwtUser) {
      return true;
    }

    // Check cache first
    const cached = UserSyncGuard.userCache.get(jwtUser.clerkId);
    if (cached && cached.expiresAt > Date.now()) {
      request.user = { ...jwtUser, ...cached.data };
      return true;
    }

    // Cache miss or expired — sync from DB via service
    const user = await this.usersService.syncOrCreateUser(jwtUser);
    this.log.debug('canActivate', 'user synced from DB', { userId: user.id });

    const userData: CachedUserData = {
      id: user.id,
      role: user.role,
      accessScope: user.accessScope,
      roleKeys: (user.roleAssignments ?? []).map((a) => a.roleKey),
      organizationId: user.organizationId,
      organization: user.organization,
    };

    UserSyncGuard.userCache.set(jwtUser.clerkId, {
      data: userData,
      expiresAt: Date.now() + UserSyncGuard.CACHE_TTL_MS,
    });

    request.user = { ...jwtUser, ...userData };

    return true;
  }

  /**
   * Drop a user's cached entry so a role change takes effect immediately rather
   * than after the TTL. Called by the role-assignment endpoint on the TARGET
   * user — without it, a revoked role keeps working for up to a minute.
   *
   * In-process only. With more than one API instance the other instances still
   * serve their own cached copy until their TTL lapses; closing that needs a
   * Redis pub/sub channel and is deliberately out of scope while we run one.
   */
  evict(clerkId: string | null | undefined): void {
    if (!clerkId) return;
    if (UserSyncGuard.userCache.delete(clerkId)) {
      this.log.debug('evict', 'user cache entry dropped', { clerkId });
    }
  }
}
