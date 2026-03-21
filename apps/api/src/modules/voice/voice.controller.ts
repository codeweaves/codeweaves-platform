import { Controller, Post, Body, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../decorators/public.decorator';
import { VoiceService } from './voice.service';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { transcribeSchema, synthesizeSchema, type TranscribeDto, type SynthesizeDto } from '@repo/validation';
import type { SupportedLanguage } from './providers/voice-provider.interface';

@ApiTags('Voice')
@Public()
@Controller('public/voice')
export class VoiceController {
  constructor(private readonly voiceService: VoiceService) {}

  @Get('providers')
  @ApiOperation({ summary: 'List registered voice providers' })
  @ApiResponse({ status: 200, description: 'List of registered provider names' })
  getProviders() {
    return { providers: this.voiceService.getRegisteredProviders() };
  }

  @Post('transcribe')
  @ApiOperation({ summary: 'Transcribe audio to text (stub — uses stub provider)' })
  @ApiResponse({ status: 200, description: 'Transcription result' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async transcribe(
    @Body(new ZodValidationPipe(transcribeSchema)) dto: TranscribeDto,
  ) {
    const result = await this.voiceService.transcribe({
      audio: Buffer.alloc(0),
      audioFormat: 'audio/webm',
      languageHint: dto.languageHint as SupportedLanguage | undefined,
      agentId: dto.agentId,
    });
    return { transcript: result.transcript, detectedLanguage: result.detectedLanguage, provider: result.provider };
  }

  @Post('synthesize')
  @ApiOperation({ summary: 'Synthesize text to audio (stub — uses stub provider)' })
  @ApiResponse({ status: 200, description: 'Synthesized audio result' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async synthesize(
    @Body(new ZodValidationPipe(synthesizeSchema)) dto: SynthesizeDto,
  ) {
    const result = await this.voiceService.synthesize({
      text: dto.text,
      language: dto.language as SupportedLanguage,
      voiceId: dto.voiceId,
      speed: dto.speed,
      agentId: dto.agentId,
    });
    return { audioFormat: result.audioFormat, durationMs: result.durationMs, provider: result.provider };
  }
}
