import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { Role } from '@prisma/client';
import { UsersService } from '../services/users.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

interface CachedUserData {
  id: string;
  role: Role;
  organizationId: string;
  organization: { id: string; name: string };
}

@Injectable()
export class UserSyncInterceptor implements NestInterceptor {
  private userCache = new Map<
    string,
    { data: CachedUserData; expiresAt: number }
  >();
  static readonly CACHE_TTL_MS = 60_000; // 60 seconds

  constructor(
    private usersService: UsersService,
    private reflector: Reflector,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const jwtUser = request.user;

    if (!jwtUser) {
      return next.handle();
    }

    // Check cache first
    const cached = this.userCache.get(jwtUser.auth0Id);
    if (cached && cached.expiresAt > Date.now()) {
      request.user = { ...jwtUser, ...cached.data };
      return next.handle();
    }

    // Cache miss or expired — sync from DB via service
    const user = await this.usersService.syncOrCreateUser(jwtUser);

    const userData: CachedUserData = {
      id: user.id,
      role: user.role,
      organizationId: user.organizationId,
      organization: user.organization,
    };

    this.userCache.set(jwtUser.auth0Id, {
      data: userData,
      expiresAt: Date.now() + UserSyncInterceptor.CACHE_TTL_MS,
    });

    request.user = { ...jwtUser, ...userData };

    return next.handle();
  }
}
