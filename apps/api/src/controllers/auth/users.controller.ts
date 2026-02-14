import { Controller, Get, Patch, Body } from '@nestjs/common';
import { UsersService } from '../../services/users.service';
import { CurrentUser, CurrentUserData } from '../../decorators/current-user.decorator';
import { UpdateUserDto } from '../../models/user.dto';

@Controller('auth/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getProfile(@CurrentUser() user: CurrentUserData) {
    // User is already synced by UserSyncInterceptor
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      organization: user.organization,
      roles: user.roles,
    };
  }

  @Patch('me')
  async updateProfile(
    @CurrentUser() user: CurrentUserData,
    @Body() data: UpdateUserDto,
  ) {
    // User is already synced by UserSyncInterceptor, so user.id is available
    return this.usersService.updateProfile(user.id, data);
  }
}
