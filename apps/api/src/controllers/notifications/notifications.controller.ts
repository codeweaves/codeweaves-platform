import { Controller, Get, Post, Param, Query, HttpCode } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { NotificationService } from '../../services/notification.service';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { CurrentUser, CurrentUserData } from '../../decorators/current-user.decorator';
import {
  notificationListQuerySchema,
  notificationIdParamsSchema,
} from '../../models/notification.dto';
import type {
  NotificationListQuery,
  NotificationIdParams,
} from '../../models/notification.dto';
import { RequirePermission } from '../../decorators/require-permission.decorator';
import { Resource, Action } from '../../common/rbac/rbac.types';

/**
 * The notification bell.
 *
 * Every route derives its tenant scope from the authenticated user — there is
 * no `orgId` parameter anywhere on this controller, so a caller cannot ask for
 * another organization's feed.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications for my organization (newest first)' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Page of notifications' })
  @RequirePermission(Resource.Notification, Action.Read)
  async list(
    @Query(new ZodValidationPipe(notificationListQuerySchema)) query: NotificationListQuery,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.notifications.list(user, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Badge count — notifications since I last opened the panel' })
  @ApiResponse({ status: 200, description: '{ count: number }' })
  @RequirePermission(Resource.Notification, Action.Read)
  async unreadCount(@CurrentUser() user: CurrentUserData) {
    return this.notifications.unreadCount(user);
  }

  @Post('seen')
  @HttpCode(200)
  @ApiOperation({ summary: 'Clear the badge (called when the bell panel opens)' })
  @ApiResponse({ status: 200, description: '{ seenAt }' })
  @RequirePermission(Resource.Notification, Action.Update)
  async markSeen(@CurrentUser() user: CurrentUserData) {
    return this.notifications.markSeen(user);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One notification by id — resolves the ?n= email deep link',
  })
  @ApiResponse({ status: 200, description: 'Notification (org-scoped)' })
  @ApiResponse({ status: 404, description: 'Not found, or not in your org' })
  @RequirePermission(Resource.Notification, Action.Read)
  async get(
    @Param(new ZodValidationPipe(notificationIdParamsSchema)) params: NotificationIdParams,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.notifications.get(user, params.id);
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark one notification read for me' })
  @ApiResponse({ status: 200, description: '{ ok: boolean }' })
  @RequirePermission(Resource.Notification, Action.Update)
  async markRead(
    @Param(new ZodValidationPipe(notificationIdParamsSchema)) params: NotificationIdParams,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.notifications.markRead(user, params.id);
  }
}
