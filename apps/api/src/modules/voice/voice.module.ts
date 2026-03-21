import { Module } from '@nestjs/common';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { StubProvider } from './providers/stub.provider';
import { SarvamProvider } from './providers/sarvam.provider';
import { DeepgramProvider } from './providers/deepgram.provider';
import { ElevenLabsProvider } from './providers/elevenlabs.provider';
import { VOICE_PROVIDERS } from './providers/voice-provider.interface';
import { ChatModule } from '../chat.module';
import { MessageRateLimitService } from '../../services/message-rate-limit.service';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [ChatModule, PrismaModule],
  controllers: [VoiceController],
  providers: [
    StubProvider,
    SarvamProvider,
    DeepgramProvider,
    ElevenLabsProvider,
    {
      provide: VOICE_PROVIDERS,
      useFactory: (
        stub: StubProvider,
        sarvam: SarvamProvider,
        deepgram: DeepgramProvider,
        elevenlabs: ElevenLabsProvider,
      ) => [stub, sarvam, deepgram, elevenlabs],
      inject: [StubProvider, SarvamProvider, DeepgramProvider, ElevenLabsProvider],
    },
    VoiceService,
    MessageRateLimitService,
  ],
  exports: [VoiceService],
})
export class VoiceModule {}
