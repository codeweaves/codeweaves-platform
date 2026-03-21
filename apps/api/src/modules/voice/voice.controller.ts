import {
  Controller,
  Post,
  Body,
  Get,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';
import { Public } from '../../decorators/public.decorator';
import { VoiceService } from './voice.service';
import { ChatService } from '../../services/chat.service';
import { MessageRateLimitService } from '../../services/message-rate-limit.service';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import {
  voiceConversationSchema,
  transcribeSchema,
  synthesizeSchema,
  voiceErrorCodes,
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
  'audio/mp4',
  'audio/aac',
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
  @ApiResponse({ status: 422, description: 'Unsupported language or STT failure' })
  @ApiResponse({ status: 429, description: 'Rate limited' })
  @ApiResponse({ status: 502, description: 'Voice provider unavailable' })
  @ApiResponse({ status: 504, description: 'Voice provider timeout' })
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: MAX_FILE_SIZE } }))
  async voiceConversation(
    @UploadedFile() audioFile: Express.Multer.File,
    @Body(new ZodValidationPipe(voiceConversationSchema)) dto: VoiceConversationDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const audioValidationError = this.validateAudioFile(audioFile);
    if (audioValidationError) {
      res.status(HttpStatus.BAD_REQUEST);
      return audioValidationError;
    }

    const deviceId = this.messageRateLimitService.getDeviceIdentifier(req);
    const rateLimitResult = await this.messageRateLimitService.checkMessageRateLimit(
      deviceId,
      dto.agentId,
    );
    if (!rateLimitResult.allowed) {
      res.status(HttpStatus.TOO_MANY_REQUESTS);
      return {
        error: true,
        errorCode: voiceErrorCodes.RATE_LIMITED,
        message: rateLimitResult.message,
        retryAfterSeconds: rateLimitResult.retryAfterSeconds,
      };
    }

    const startTime = Date.now();

    // Step 1: STT
    const sttStart = Date.now();
    let sttResult;
    try {
      sttResult = await this.voiceService.transcribe({
        audio: audioFile.buffer,
        audioFormat: audioFile.mimetype,
        languageHint: dto.languageHint as SupportedLanguage | undefined,
        agentId: dto.agentId,
      });
    } catch (error) {
      const { errorCode, status } = this.classifyVoiceError(error);
      this.reportVoiceErrorToSentry(error, {
        provider: error instanceof VoiceProviderError ? error.provider : 'unknown',
        language: dto.languageHint ?? 'unknown',
        agentId: dto.agentId,
        operation: 'stt',
        errorType: 'stt_failure',
      });
      res.status(status);
      return {
        error: true,
        errorCode,
        message: 'Speech recognition failed',
      };
    }
    const sttLatencyMs = Date.now() - sttStart;

    // Step 2: Chat (reuse existing text-based chat flow)
    if (!sttResult.transcript.trim()) {
      res.status(HttpStatus.UNPROCESSABLE_ENTITY);
      return {
        error: true,
        errorCode: voiceErrorCodes.AUDIO_TOO_SHORT,
        message: 'Could not transcribe audio — no speech detected',
      };
    }

    const aiStart = Date.now();
    let chatResult;
    try {
      chatResult = await this.chatService.sendMessage({
        agentId: dto.agentId,
        chatInput: sttResult.transcript,
        sessionId: dto.sessionId,
      });
    } catch (error) {
      this.logger.error(
        `Chat service failed for agent ${dto.agentId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      this.reportVoiceErrorToSentry(error, {
        provider: 'chat',
        language: sttResult.detectedLanguage,
        agentId: dto.agentId,
        operation: 'stt',
        errorType: 'chat_failure',
      });
      res.status(HttpStatus.BAD_GATEWAY);
      return {
        error: true,
        errorCode: voiceErrorCodes.PROVIDER_UNAVAILABLE,
        message: 'AI service temporarily unavailable',
      };
    }
    const aiLatencyMs = Date.now() - aiStart;

    // Step 3: TTS (skip if disabled) — graceful degradation on failure
    let ttsAudio: string | null = null;
    let ttsFormat: string | null = null;
    let ttsDurationMs: number | null = null;
    let ttsLatencyMs = 0;
    let ttsError: { errorCode: string; message: string } | undefined;

    let voiceConfig: { ttsEnabled?: boolean };
    try {
      voiceConfig = await this.voiceService.getVoiceConfig(dto.agentId);
    } catch (error) {
      this.logger.warn(
        `Failed to fetch voice config for agent ${dto.agentId}, defaulting to TTS enabled: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      voiceConfig = { ttsEnabled: true };
    }
    if (voiceConfig.ttsEnabled !== false && chatResult.reply.trim()) {
      const ttsStart = Date.now();
      try {
        const ttsResult = await this.voiceService.synthesize({
          text: chatResult.reply,
          language: sttResult.detectedLanguage,
          agentId: dto.agentId,
        });
        ttsLatencyMs = Date.now() - ttsStart;
        ttsAudio = ttsResult.audio.toString('base64');
        ttsFormat = ttsResult.audioFormat;
        ttsDurationMs = ttsResult.durationMs ?? null;
      } catch (error) {
        ttsLatencyMs = Date.now() - ttsStart;
        // TTS failure is graceful degradation — return text response, not 500
        this.reportVoiceErrorToSentry(
          error,
          {
            provider: error instanceof VoiceProviderError ? error.provider : 'unknown',
            language: sttResult.detectedLanguage,
            agentId: dto.agentId,
            operation: 'tts',
            errorType: 'tts_failure',
            fallbackAttempted: true,
          },
          'warning',
        );
        ttsError = {
          errorCode: voiceErrorCodes.TTS_FAILED,
          message: 'Voice playback unavailable',
        };
        this.logger.warn(
          `TTS failed for agent ${dto.agentId}, returning text-only response: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
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
      ...(ttsError && { ttsError }),
    };
  }

  @Post('transcribe')
  @ApiOperation({ summary: 'Transcribe audio to text (STT only)' })
  @ApiResponse({ status: 200, description: 'Transcription result' })
  @ApiResponse({ status: 400, description: 'Invalid input or missing audio file' })
  @ApiResponse({ status: 422, description: 'STT failure or unsupported language' })
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: MAX_FILE_SIZE } }))
  async transcribe(
    @UploadedFile() audioFile: Express.Multer.File,
    @Body(new ZodValidationPipe(transcribeSchema)) dto: TranscribeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const audioValidationError = this.validateAudioFile(audioFile);
    if (audioValidationError) {
      res.status(HttpStatus.BAD_REQUEST);
      return audioValidationError;
    }

    const deviceId = this.messageRateLimitService.getDeviceIdentifier(req);
    const rateLimitResult = await this.messageRateLimitService.checkMessageRateLimit(
      deviceId,
      dto.agentId,
    );
    if (!rateLimitResult.allowed) {
      res.status(HttpStatus.TOO_MANY_REQUESTS);
      return {
        error: true,
        errorCode: voiceErrorCodes.RATE_LIMITED,
        message: rateLimitResult.message,
        retryAfterSeconds: rateLimitResult.retryAfterSeconds,
      };
    }

    try {
      const result = await this.voiceService.transcribe({
        audio: audioFile.buffer,
        audioFormat: audioFile.mimetype,
        languageHint: dto.languageHint as SupportedLanguage | undefined,
        agentId: dto.agentId,
      });

      return {
        text: result.transcript,
        detectedLanguage: result.detectedLanguage,
        confidence: result.confidence,
        latencyMs: result.latencyMs,
      };
    } catch (error) {
      const { errorCode, status } = this.classifyVoiceError(error);
      this.reportVoiceErrorToSentry(error, {
        provider: error instanceof VoiceProviderError ? error.provider : 'unknown',
        language: dto.languageHint ?? 'unknown',
        agentId: dto.agentId,
        operation: 'stt',
        errorType: 'stt_failure',
      });
      res.status(status);
      return {
        error: true,
        errorCode,
        message: 'Speech recognition failed',
      };
    }
  }

  @Post('synthesize')
  @ApiOperation({ summary: 'Synthesize text to audio (TTS only)' })
  @ApiResponse({ status: 200, description: 'Synthesized audio result' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 422, description: 'Unsupported language' })
  async synthesize(
    @Body(new ZodValidationPipe(synthesizeSchema)) dto: SynthesizeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const deviceId = this.messageRateLimitService.getDeviceIdentifier(req);
    const rateLimitResult = await this.messageRateLimitService.checkMessageRateLimit(
      deviceId,
      dto.agentId,
    );
    if (!rateLimitResult.allowed) {
      res.status(HttpStatus.TOO_MANY_REQUESTS);
      return {
        error: true,
        errorCode: voiceErrorCodes.RATE_LIMITED,
        message: rateLimitResult.message,
        retryAfterSeconds: rateLimitResult.retryAfterSeconds,
      };
    }

    try {
      const result = await this.voiceService.synthesize({
        text: dto.text,
        language: dto.language as SupportedLanguage,
        voiceId: dto.voiceId,
        speed: dto.speed,
        agentId: dto.agentId,
      });

      return {
        audio: result.audio.toString('base64'),
        format: result.audioFormat,
        durationMs: result.durationMs ?? null,
        latencyMs: result.latencyMs,
      };
    } catch (error) {
      const { errorCode, status } = this.classifyVoiceError(error, 'tts');
      this.reportVoiceErrorToSentry(error, {
        provider: error instanceof VoiceProviderError ? error.provider : 'unknown',
        language: dto.language,
        agentId: dto.agentId,
        operation: 'tts',
        errorType: 'tts_failure',
      });
      res.status(status);
      return {
        error: true,
        errorCode,
        message: 'Voice synthesis failed',
      };
    }
  }

  @Get('providers')
  @ApiOperation({ summary: 'List available voice providers and their capabilities' })
  @ApiResponse({ status: 200, description: 'Provider list with supported languages' })
  getProviders() {
    return { providers: this.voiceService.getProvidersInfo() };
  }

  private validateAudioFile(file: Express.Multer.File): { error: true; errorCode: string; message: string } | null {
    if (!file) {
      return { error: true, errorCode: voiceErrorCodes.INVALID_AUDIO, message: 'Audio file is required' };
    }
    if (!ALLOWED_AUDIO_MIMES.has(file.mimetype)) {
      return {
        error: true,
        errorCode: voiceErrorCodes.INVALID_AUDIO,
        message: `Invalid audio format: ${file.mimetype}. Allowed: ${[...ALLOWED_AUDIO_MIMES].join(', ')}`,
      };
    }
    return null;
  }

  private classifyVoiceError(error: unknown, operation: 'stt' | 'tts' = 'stt'): { errorCode: string; status: number } {
    if (error instanceof UnsupportedLanguageError) {
      return { errorCode: voiceErrorCodes.UNSUPPORTED_LANGUAGE, status: HttpStatus.UNPROCESSABLE_ENTITY };
    }
    if (error instanceof VoiceProviderError) {
      const providerStatus = error.getStatus();
      if (providerStatus === HttpStatus.GATEWAY_TIMEOUT) {
        return { errorCode: voiceErrorCodes.PROVIDER_TIMEOUT, status: HttpStatus.GATEWAY_TIMEOUT };
      }
      return { errorCode: voiceErrorCodes.PROVIDER_UNAVAILABLE, status: providerStatus };
    }
    const fallbackCode = operation === 'tts' ? voiceErrorCodes.TTS_FAILED : voiceErrorCodes.STT_FAILED;
    return { errorCode: fallbackCode, status: HttpStatus.UNPROCESSABLE_ENTITY };
  }

  private reportVoiceErrorToSentry(
    error: unknown,
    context: {
      provider: string;
      language: string;
      agentId: string;
      operation: 'stt' | 'tts';
      errorType?: string;
      fallbackAttempted?: boolean;
    },
    level: 'error' | 'warning' = 'error',
  ): void {
    Sentry.withScope((scope) => {
      scope.setContext('voice', context);
      scope.setLevel(level);
      if (error instanceof Error) {
        Sentry.captureException(error);
      } else {
        Sentry.captureMessage(`Voice ${context.operation} failure`, { level });
      }
    });
  }
}
