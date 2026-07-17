import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppLogger } from '../common/logger/app-logger';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly log = new AppLogger(JwtAuthGuard.name);

  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<TUser = unknown>(err: Error | null, user: TUser): TUser {
    if (err || !user) {
      this.log.warn('handleRequest', 'authentication rejected', {
        reason: err ? 'jwt-error' : 'no-user',
      });
      throw err || new UnauthorizedException('Authentication required');
    }
    return user;
  }
}
