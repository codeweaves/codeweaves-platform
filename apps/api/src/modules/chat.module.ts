import { Module } from '@nestjs/common';
import { ChatService } from '../services/chat.service';
import { MessageRateLimitService } from '../services/message-rate-limit.service';
import { N8nStreamingService } from '../services/n8n-streaming.service';
import { PublicChatController } from '../controllers/public/public-chat.controller';
import { PrismaModule } from './prisma.module';
import { AgentsModule } from './agents.module';

@Module({
  imports: [PrismaModule, AgentsModule],
  controllers: [PublicChatController],
  providers: [ChatService, MessageRateLimitService, N8nStreamingService],
  exports: [ChatService, N8nStreamingService],
})
export class ChatModule {}
