import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';

export interface CurrentUserData {
  // From JWT
  auth0Id: string;
  email: string;
  roles: string[];

  // From database (populated by UserSyncInterceptor)
  id: string;
  role: Role;
  organizationId: string;
  organization: {
    id: string;
    name: string;
  };
}

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserData | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as CurrentUserData;

    return data ? user?.[data] : user;
  },
);
