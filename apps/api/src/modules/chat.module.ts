import { Module } from "@nestjs/common";
import { ChatService } from "../services/chat.service";
import { ConsentService } from "../services/consent.service";
import { MessageMetricsService } from "../services/message-metrics.service";
import { MessageRateLimitService } from "../services/message-rate-limit.service";
import { PublicChatController } from "../controllers/public/public-chat.controller";
import { PublicConsentController } from "../controllers/public/public-consent.controller";
import { PrismaModule } from "./prisma.module";
import { AiModule } from "./ai/ai.module";
import { HandoverModule } from "./handover.module";

@Module({
  // AiModule gives us DirectChatService, which serves every reply (ChatService
  // sendMessage and PublicChatController.stream). HandoverModule gives
  // PublicChatController the HandoverService for
  // the AI-pause / keyword-trigger / stall hooks on the chat hot-path.
  // ConsentService lives here because ChatService gates new sessions on it.
  imports: [PrismaModule, AiModule, HandoverModule],
  controllers: [PublicChatController, PublicConsentController],
  providers: [
    ChatService,
    ConsentService,
    MessageMetricsService,
    MessageRateLimitService,
  ],
  exports: [ChatService, ConsentService, MessageMetricsService],
})
export class ChatModule {}
