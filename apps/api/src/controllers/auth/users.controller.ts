import { Controller, Get, Patch, Body } from '@nestjs/common';
import { UsersService } from '../../services/users.service';
import { CurrentUser, CurrentUserData } from '../../decorators/current-user.decorator';

@Controller('auth/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getProfile(@CurrentUser() user: CurrentUserData) {
    const dbUser = await this.usersService.findByAuth0Id(user.auth0Id);
    if (!dbUser) {
      return {
        auth0Id: user.auth0Id,
        email: user.email,
        roles: user.roles,
        synced: false,
      };
    }
    return {
      ...dbUser,
      roles: user.roles,
      synced: true,
    };
  }

  @Patch('me')
  async updateProfile(
    @CurrentUser() user: CurrentUserData,
    @Body() data: { name?: string },
  ) {
    const dbUser = await this.usersService.findByAuth0Id(user.auth0Id);
    if (!dbUser) {
      throw new Error('User not found in database');
    }
    return this.usersService.updateProfile(dbUser.id, data);
  }
}
