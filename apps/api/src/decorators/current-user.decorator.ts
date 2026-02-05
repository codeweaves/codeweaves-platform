import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserData {
  auth0Id: string;
  email: string;
  roles: string[];
  organizationId?: string;
  userId?: string;  // Our internal user ID (populated after sync)
}

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserData | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as CurrentUserData;

    return data ? user?.[data] : user;
  },
);
