import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';

export interface CurrentUserData {
  // From JWT
  auth0Id: string;
  email: string;
  roles: string[];

  // From database (populated by UserSyncGuard)
  id: string;
  role: Role;
  organizationId: string | null;
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserData | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as CurrentUserData;

    return data ? user?.[data] : user;
  },
);
