import { Global, Module } from '@nestjs/common';
import { TracerModule } from '../tracer/tracer.module';
import { WidgetEventLogger } from './widget.logger';
import { VoiceEventLogger } from './voice.logger';
import { WhatsappEventLogger } from './whatsapp.logger';
import { InternalEventLogger } from './internal.logger';
import { ProviderEventLogger } from './provider.logger';

const loggers = [
  WidgetEventLogger,
  VoiceEventLogger,
  WhatsappEventLogger,
  InternalEventLogger,
  ProviderEventLogger,
];

/**
 * Global module exposing the channel + provider event loggers. Import once in
 * AppModule; every module can then inject any of these without re-importing.
 */
@Global()
@Module({
  imports: [TracerModule],
  providers: loggers,
  exports: loggers,
})
export class EventsModule {}
