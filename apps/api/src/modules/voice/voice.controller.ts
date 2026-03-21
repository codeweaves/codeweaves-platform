import {
  Controller,
  Post,
  Body,
  Get,
  Req,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../decorators/public.decorator';
import { VoiceService } from './voice.service';
import { ChatService } from '../../services/chat.service';
import { MessageRateLimitService } from '../../services/message-rate-limit.service';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import {
  voiceConversationSchema,
  transcribeSchema,
  synthesizeSchema,
  type VoiceConversationDto,
  type TranscribeDto,
  type SynthesizeDto,
} from '@repo/validation';
import {
  UnsupportedLanguageError,
  VoiceProviderError,
  type SupportedLanguage,
} from './providers/voice-provider.interface';

const ALLOWED_AUDIO_MIMES = new Set([
  'audio/webm',
  'audio/wav',
  'audio/mp3',
  'audio/mpeg',
  'audio/ogg',
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

@ApiTags('Voice')
@Public()
@Controller('public/voice')
export class VoiceController {
  private readonly logger = new Logger(VoiceController.name);

  constructor(
    private readonly voiceService: VoiceService,
    private readonly chatService: ChatService,
    private readonly messageRateLimitService: MessageRateLimitService,
  ) {}

  @Post('conversation')
  @ApiOperation({ summary: 'Full voice conversation: audio in, audio + text out' })
  @ApiResponse({ status: 200, description: 'Voice conversation result' })
  @ApiResponse({ status: 400, description: 'Invalid input or missing audio file' })
  @ApiResponse({ status: 422, description: 'Unsupported language' })
  @ApiResponse({ status: 502, description: 'Voice provider error' })
  @ApiResponse({ status: 504, description: 'Voice provider timeout' })
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: MAX_FILE_SIZE } }))
  async voiceConversation(
    @UploadedFile() audioFile: Express.Multer.File,
    @Body(new ZodValidationPipe(voiceConversationSchema)) dto: VoiceConversationDto,
    @Req() req: Request,
  ) {
    this.validateAudioFile(audioFile);

    const deviceId = this.messageRateLimitService.getDeviceIdentifier(req);
    const rateLimitResult = await this.messageRateLimitService.checkMessageRateLimit(
      deviceId,
      dto.agentId,
    );
    if (!rateLimitResult.allowed) {
      return { error: true, message: rateLimitResult.message, retryAfterSeconds: rateLimitResult.retryAfterSeconds };
    }

    const startTime = Date.now();

    // Step 1: STT
    const sttStart = Date.now();
    const sttResult = await this.handleProviderCall(() =>
      this.voiceService.transcribe({
        audio: audioFile.buffer,
        audioFormat: audioFile.mimetype,
        languageHint: dto.languageHint as SupportedLanguage | undefined,
        agentId: dto.agentId,
      }),
    );
    const sttLatencyMs = Date.now() - sttStart;

    // Step 2: Chat (reuse existing text-based chat flow)
    if (!sttResult.transcript.trim()) {
      throw new BadRequestException('Could not transcribe audio — no speech detected');
    }

    const aiStart = Date.now();
    const chatResult = await this.chatService.sendMessage({
      agentId: dto.agentId,
      chatInput: sttResult.transcript,
      sessionId: dto.sessionId,
    });
    const aiLatencyMs = Date.now() - aiStart;

    // Step 3: TTS (skip if disabled)
    let ttsAudio: string | null = null;
    let ttsFormat: string | null = null;
    let ttsDurationMs: number | null = null;
    let ttsLatencyMs = 0;

    const voiceConfig = await this.voiceService.getVoiceConfig(dto.agentId);
    if (voiceConfig.ttsEnabled !== false && chatResult.reply.trim()) {
      const ttsStart = Date.now();
      const ttsResult = await this.handleProviderCall(() =>
        this.voiceService.synthesize({
          text: chatResult.reply,
          language: sttResult.detectedLanguage,
          agentId: dto.agentId,
        }),
      );
      ttsLatencyMs = Date.now() - ttsStart;
      ttsAudio = ttsResult.audio.toString('base64');
      ttsFormat = ttsResult.audioFormat;
      ttsDurationMs = ttsResult.durationMs ?? null;
    }

    return {
      transcription: {
        text: sttResult.transcript,
        detectedLanguage: sttResult.detectedLanguage,
        confidence: sttResult.confidence,
      },
      response: {
        text: chatResult.reply,
        audio: ttsAudio,
        audioFormat: ttsFormat,
        audioDurationMs: ttsDurationMs,
      },
      sessionId: chatResult.sessionId,
      messageId: chatResult.messageId,
      metrics: {
        sttLatencyMs,
        aiLatencyMs,
        ttsLatencyMs,
        totalLatencyMs: Date.now() - startTime,
      },
    };
  }

  @Post('transcribe')
  @ApiOperation({ summary: 'Transcribe audio to text (STT only)' })
  @ApiResponse({ status: 200, description: 'Transcription result' })
  @ApiResponse({ status: 400, description: 'Invalid input or missing audio file' })
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: MAX_FILE_SIZE } }))
  async transcribe(
    @UploadedFile() audioFile: Express.Multer.File,
    @Body(new ZodValidationPipe(transcribeSchema)) dto: TranscribeDto,
    @Req() req: Request,
  ) {
    this.validateAudioFile(audioFile);

    const deviceId = this.messageRateLimitService.getDeviceIdentifier(req);
    const rateLimitResult = await this.messageRateLimitService.checkMessageRateLimit(
      deviceId,
      dto.agentId,
    );
    if (!rateLimitResult.allowed) {
      return { error: true, message: rateLimitResult.message, retryAfterSeconds: rateLimitResult.retryAfterSeconds };
    }

    const result = await this.handleProviderCall(() =>
      this.voiceService.transcribe({
        audio: audioFile.buffer,
        audioFormat: audioFile.mimetype,
        languageHint: dto.languageHint as SupportedLanguage | undefined,
        agentId: dto.agentId,
      }),
    );

    return {
      text: result.transcript,
      detectedLanguage: result.detectedLanguage,
      confidence: result.confidence,
      latencyMs: result.latencyMs,
    };
  }

  @Post('synthesize')
  @ApiOperation({ summary: 'Synthesize text to audio (TTS only)' })
  @ApiResponse({ status: 200, description: 'Synthesized audio result' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async synthesize(
    @Body(new ZodValidationPipe(synthesizeSchema)) dto: SynthesizeDto,
    @Req() req: Request,
  ) {
    const deviceId = this.messageRateLimitService.getDeviceIdentifier(req);
    const rateLimitResult = await this.messageRateLimitService.checkMessageRateLimit(
      deviceId,
      dto.agentId,
    );
    if (!rateLimitResult.allowed) {
      return { error: true, message: rateLimitResult.message, retryAfterSeconds: rateLimitResult.retryAfterSeconds };
    }

    const result = await this.handleProviderCall(() =>
      this.voiceService.synthesize({
        text: dto.text,
        language: dto.language as SupportedLanguage,
        voiceId: dto.voiceId,
        speed: dto.speed,
        agentId: dto.agentId,
      }),
    );

    return {
      audio: result.audio.toString('base64'),
      format: result.audioFormat,
      durationMs: result.durationMs ?? null,
      latencyMs: result.latencyMs,
    };
  }

  @Get('providers')
  @ApiOperation({ summary: 'List available voice providers and their capabilities' })
  @ApiResponse({ status: 200, description: 'Provider list with supported languages' })
  getProviders() {
    return { providers: this.voiceService.getProvidersInfo() };
  }

  private validateAudioFile(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('Audio file is required');
    }
    if (!ALLOWED_AUDIO_MIMES.has(file.mimetype)) {
      throw new BadRequestException(
        `Invalid audio format: ${file.mimetype}. Allowed: ${[...ALLOWED_AUDIO_MIMES].join(', ')}`,
      );
    }
  }

  private async handleProviderCall<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof UnsupportedLanguageError) {
        throw new HttpException(error.message, HttpStatus.UNPROCESSABLE_ENTITY);
      }
      if (error instanceof VoiceProviderError) {
        // Preserve the original HTTP status set by the provider (e.g. 504 for timeout, 502 for errors)
        throw new HttpException(error.message, error.getStatus());
      }
      throw error;
    }
  }
}
