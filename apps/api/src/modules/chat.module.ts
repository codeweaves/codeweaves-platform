import { Module } from '@nestjs/common';
import { ChatService } from '../services/chat.service';
import { MessageRateLimitService } from '../services/message-rate-limit.service';
import { PublicChatController } from '../controllers/public/public-chat.controller';
import { PrismaModule } from './prisma.module';
import { AgentsModule } from './agents.module';

@Module({
  imports: [PrismaModule, AgentsModule],
  controllers: [PublicChatController],
  providers: [ChatService, MessageRateLimitService],
  exports: [ChatService],
})
export class ChatModule {}
