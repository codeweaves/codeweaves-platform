import { Module } from '@nestjs/common';
import { ConversationsService } from '../services/conversations.service';
import { ConversationsController } from '../controllers/conversations/conversations.controller';
import { PrismaModule } from './prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
