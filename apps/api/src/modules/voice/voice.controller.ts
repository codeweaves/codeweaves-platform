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
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';
import { Public } from '../../decorators/public.decorator';
import { VoiceService } from './voice.service';
import { ChatService } from '../../services/chat.service';
import { N8nStreamingService } from '../../services/n8n-streaming.service';
import { AgentsService } from '../../services/agents.service';
import { PrismaService } from '../../services/prisma.service';
import { MessageRateLimitService } from '../../services/message-rate-limit.service';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import {
  voiceConversationSchema,
  transcribeSchema,
  synthesizeSchema,
  voiceErrorCodes,
  type VoiceConversationDto,
  type VoiceConfigDto,
  type TranscribeDto,
  type SynthesizeDto,
} from '@repo/validation';
import {
  UnsupportedLanguageError,
  VoiceProviderError,
  type SupportedLanguage,
  type STTResponse,
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
    private readonly n8nStreamingService: N8nStreamingService,
    private readonly agentsService: AgentsService,
    private readonly prisma: PrismaService,
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

    if (!sttResult.transcript.trim()) {
      res.status(HttpStatus.UNPROCESSABLE_ENTITY);
      return {
        error: true,
        errorCode: voiceErrorCodes.AUDIO_TOO_SHORT,
        message: 'Could not transcribe audio — no speech detected',
      };
    }

    // Streaming path: if agent has a webhookUrl, use progressive TTS
    let webhookUrl: string | null = null;
    try {
      webhookUrl = await this.agentsService.getEffectiveWebhookUrl(dto.agentId);
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        this.logger.error(
          `Failed to fetch webhook URL for agent ${dto.agentId}: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
      // No webhook URL or error — fall through to legacy sequential path
    }

    let voiceConfig: VoiceConfigDto;
    try {
      voiceConfig = await this.voiceService.getVoiceConfig(dto.agentId);
    } catch (error) {
      this.logger.warn(
        `Failed to fetch voice config for agent ${dto.agentId}, defaulting to TTS enabled: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      voiceConfig = { ttsEnabled: true } as VoiceConfigDto;
    }

    if (webhookUrl && voiceConfig.ttsEnabled !== false) {
      await this.handleStreamingVoice(
        dto, sttResult, sttLatencyMs, webhookUrl, voiceConfig, startTime, res,
      );
      return;
    }

    // Legacy sequential path: Chat → TTS
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
    let ttsProvider: string | null = null;
    let ttsError: { errorCode: string; message: string } | undefined;

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
        ttsProvider = ttsResult.provider;
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

    // Store voice metadata on user and assistant messages for analytics (AC #1, #2, #3)
    const ttsAttempted = ttsAudio !== null || ttsError !== undefined;
    const userMetadata = {
      ...(chatResult.metadata as Record<string, unknown> ?? {}),
      inputType: 'voice' as const,
      detectedLanguage: sttResult.detectedLanguage,
      languageConfidence: sttResult.confidence,
      sttProvider: sttResult.provider ?? 'unknown',
      sttLatencyMs,
      aiLatencyMs,
    };
    const assistantMetadata = {
      ...(chatResult.metadata as Record<string, unknown> ?? {}),
      inputType: 'voice' as const,
      ...(ttsAttempted && { ttsProvider: ttsProvider ?? 'unknown' }),
      ...(ttsAttempted && { ttsLatencyMs }),
      ...(ttsError && { ttsError: ttsError.errorCode }),
    };

    const storeMetadata = async (attempt = 1) => {
      try {
        await Promise.all([
          this.prisma.chatMessage.update({
            where: { id: chatResult.messageId },
            data: { metadata: userMetadata },
          }),
          this.prisma.chatMessage.update({
            where: { id: chatResult.assistantMessageId },
            data: { metadata: assistantMetadata },
          }),
        ]);
      } catch (metadataError) {
        if (attempt < 2) {
          this.logger.warn(
            `Voice metadata write attempt ${attempt} failed for message ${chatResult.messageId}, retrying...`,
          );
          return storeMetadata(attempt + 1);
        }
        this.logger.warn(
          `Failed to store voice metadata for message ${chatResult.messageId} after ${attempt} attempts: ${metadataError instanceof Error ? metadataError.message : 'unknown'}`,
        );
      }
    };
    // Fire-and-forget — don't block the response
    storeMetadata();

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

  private async handleStreamingVoice(
    dto: VoiceConversationDto,
    sttResult: STTResponse,
    sttLatencyMs: number,
    webhookUrl: string,
    voiceConfig: VoiceConfigDto,
    startTime: number,
    res: Response,
  ): Promise<void> {
    // Resolve session for message storage
    const session = await this.chatService.resolveOrCreateSession(dto.agentId, dto.sessionId);
    const userMessage = await this.chatService.saveUserMessage(session.id, sttResult.transcript);

    // Set chunked response headers
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Session-Id', session.id);
    res.setHeader('X-Message-Id', userMessage.id);

    // Client disconnect handling
    let closed = false;
    const abortController = new AbortController();
    res.on('close', () => {
      closed = true;
      abortController.abort();
    });

    // Stream timeout (60s — voice streams are slower than text due to TTS per sentence)
    const VOICE_STREAM_TIMEOUT_MS = 60_000;
    const timeout = setTimeout(() => {
      if (!closed) {
        const timeoutChunk = {
          type: 'error' as const,
          errorCode: voiceErrorCodes.PROVIDER_TIMEOUT,
          message: 'Voice stream timeout — response took too long',
        };
        res.write(JSON.stringify(timeoutChunk) + '\n');
        res.end();
        closed = true;
        abortController.abort();
      }
    }, VOICE_STREAM_TIMEOUT_MS);

    const tokenStream = this.n8nStreamingService.streamFromWebhookUrl(
      webhookUrl,
      sttResult.transcript,
      session.sessionId,
      abortController.signal,
    );

    const ttsLatencies: number[] = [];
    let fullText = '';
    let totalSentences = 0;
    let timeToFirstChunkMs: number | null = null;

    try {
      const voiceStream = this.voiceService.streamingTTS(
        tokenStream,
        sttResult.detectedLanguage,
        dto.agentId,
        voiceConfig,
      );

      for await (const chunk of voiceStream) {
        if (closed) break;

        if (chunk.type === 'audio') {
          ttsLatencies.push(chunk.ttsLatencyMs);
          if (timeToFirstChunkMs === null) {
            timeToFirstChunkMs = Date.now() - startTime;
          }
        }
        if (chunk.type === 'end') {
          fullText = chunk.fullText;
          totalSentences = chunk.totalSentences;
        }
        res.write(JSON.stringify(chunk) + '\n');
      }
    } catch (error) {
      if (!closed) {
        this.logger.error(
          `Streaming voice failed for agent ${dto.agentId}: ${error instanceof Error ? error.message : 'unknown'}`,
        );
        this.reportVoiceErrorToSentry(error, {
          provider: 'streaming',
          language: sttResult.detectedLanguage,
          agentId: dto.agentId,
          operation: 'tts',
          errorType: 'streaming_voice_failure',
        });
        const errorChunk = {
          type: 'error' as const,
          errorCode: voiceErrorCodes.PROVIDER_UNAVAILABLE,
          message: 'Streaming voice pipeline failed',
        };
        res.write(JSON.stringify(errorChunk) + '\n');
      }
    } finally {
      clearTimeout(timeout);
      if (!closed) {
        res.end();
      }
    }

    // Store assistant message and user message metadata
    const averageTtsLatencyMs = ttsLatencies.length > 0
      ? Math.round(ttsLatencies.reduce((a, b) => a + b, 0) / ttsLatencies.length)
      : 0;

    const metadata = {
      inputType: 'voice' as const,
      streaming: true,
      detectedLanguage: sttResult.detectedLanguage,
      sttLatencyMs,
      totalSentences,
      averageTtsLatencyMs,
      timeToFirstChunkMs,
      totalLatencyMs: Date.now() - startTime,
    };

    try {
      await Promise.all([
        fullText
          ? this.chatService.saveAssistantMessage(session.id, fullText, metadata)
          : this.chatService.saveAssistantMessage(session.id, '[streaming failed]', { ...metadata, error: true }),
        this.prisma.chatMessage.update({
          where: { id: userMessage.id },
          data: {
            metadata: {
              inputType: 'voice',
              detectedLanguage: sttResult.detectedLanguage,
              languageConfidence: sttResult.confidence,
              sttProvider: sttResult.provider ?? 'unknown',
              sttLatencyMs,
            },
          },
        }),
      ]);
    } catch (err) {
      this.logger.warn(
        `Failed to save streaming voice messages: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
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
