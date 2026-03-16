import { Module } from '@nestjs/common';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { StubProvider } from './providers/stub.provider';
import { VOICE_PROVIDERS } from './providers/voice-provider.interface';

@Module({
  controllers: [VoiceController],
  providers: [
    StubProvider,
    {
      provide: VOICE_PROVIDERS,
      useFactory: (stub: StubProvider) => [stub],
      inject: [StubProvider],
    },
    VoiceService,
  ],
  exports: [VoiceService],
})
export class VoiceModule {}
