import { Controller, Get, Patch, Body, NotFoundException } from '@nestjs/common';
import { UsersService } from '../../services/users.service';
import { CurrentUser, CurrentUserData } from '../../decorators/current-user.decorator';
import { UpdateUserDto } from '../../models/user.dto';

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
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      role: dbUser.role,
      organizationId: dbUser.organizationId,
      roles: user.roles,
      synced: true,
    };
  }

  @Patch('me')
  async updateProfile(
    @CurrentUser() user: CurrentUserData,
    @Body() data: UpdateUserDto,
  ) {
    const dbUser = await this.usersService.findByAuth0Id(user.auth0Id);
    if (!dbUser) {
      throw new NotFoundException('User not found in database');
    }
    return this.usersService.updateProfile(dbUser.id, data);
  }
}
