import { Module, forwardRef } from '@nestjs/common';
import { NotificationService } from '../services/notification.service';
import { NotificationMailerService } from '../services/notification-mailer.service';
import { NotificationsController } from '../controllers/notifications/notifications.controller';
import { PrismaModule } from './prisma.module';
import { EmailModule } from './email.module';
import { HandoverModule } from './handover.module';

/**
 * Dashboard notifications: the bell (read side) and the single `emit` entry
 * point producers call (write side).
 *
 * forwardRef with HandoverModule because the dependency is genuinely mutual —
 * notifications need RealtimeService to push over the socket, and the handover
 * service needs NotificationService to raise a notification when a visitor asks
 * for a human.
 */
@Module({
  imports: [PrismaModule, EmailModule, forwardRef(() => HandoverModule)],
  controllers: [NotificationsController],
  providers: [NotificationService, NotificationMailerService],
  exports: [NotificationService],
})
export class NotificationsModule {}
