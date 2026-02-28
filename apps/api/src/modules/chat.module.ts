import { Module } from '@nestjs/common';
import { ChatService } from '../services/chat.service';
import { PublicChatController } from '../controllers/public/public-chat.controller';
import { PrismaModule } from './prisma.module';
import { AgentsModule } from './agents.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { LoggerModule } from '../common/logger/logger.module';

@Module({
  imports: [PrismaModule, AgentsModule, CryptoModule, LoggerModule],
  controllers: [PublicChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
