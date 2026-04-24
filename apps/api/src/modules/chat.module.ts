import { Module } from '@nestjs/common';
import { ChatService } from '../services/chat.service';
import { MessageRateLimitService } from '../services/message-rate-limit.service';
import { N8nStreamingService } from '../services/n8n-streaming.service';
import { PublicChatController } from '../controllers/public/public-chat.controller';
import { PrismaModule } from './prisma.module';
import { AgentsModule } from './agents.module';
import { AiModule } from './ai/ai.module';

@Module({
  // AiModule gives us DirectChatService (used by both ChatService for
  // direct-mode sendMessage and by PublicChatController.stream for direct-mode
  // SSE streaming). Once n8n is retired this import becomes redundant-but-
  // harmless.
  imports: [PrismaModule, AgentsModule, AiModule],
  controllers: [PublicChatController],
  providers: [ChatService, MessageRateLimitService, N8nStreamingService],
  exports: [ChatService, N8nStreamingService],
})
export class ChatModule {}
