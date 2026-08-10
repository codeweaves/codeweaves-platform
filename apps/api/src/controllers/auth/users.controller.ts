import { Controller, Get, Patch, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UsersService } from '../../services/users.service';
import { SelfOnly } from '../../decorators/self-only.decorator';
import {
  CurrentUser,
  CurrentUserData,
} from '../../decorators/current-user.decorator';
import { updateUserProfileSchema } from '../../models/user.dto';
import type { UpdateUserProfileDto, UserProfileResponse } from '../../models/user.dto';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';

@ApiTags('Users')
@ApiBearerAuth()
// Both routes resolve solely from `user.id` and take no target identifier, so
// they need no permission. @SelfOnly declares that deliberately, which is what
// the boot-time route assertion checks for.
@SelfOnly()
@Controller('auth/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getProfile(
    @CurrentUser() user: CurrentUserData,
  ): Promise<UserProfileResponse> {
    return this.usersService.getProfile(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({ status: 200, description: 'Profile updated' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updateProfile(
    @CurrentUser() user: CurrentUserData,
    @Body(new ZodValidationPipe(updateUserProfileSchema))
    dto: UpdateUserProfileDto,
  ): Promise<UserProfileResponse> {
    return this.usersService.updateProfile(user.id, dto);
  }
}
