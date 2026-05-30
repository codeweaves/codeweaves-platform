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
import { DirectChatService } from '../ai/direct-chat.service';
import { directChatToN8nStream } from '../ai/adapters/voice-token-stream.adapter';
import { resolveRoutingMode } from '@repo/validation';
import type { N8nStreamChunk } from '../../services/n8n-stream.interface';
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
    private readonly directChatService: DirectChatService,
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

    // Resolve publicId → internal UUID (widget sends publicId, not UUID)
    const agent = await this.chatService.resolveAgent(dto.agentId);
    const resolvedAgentId = agent.id;

    const deviceId = this.messageRateLimitService.getDeviceIdentifier(req);
    const rateLimitResult = await this.messageRateLimitService.checkMessageRateLimit(
      deviceId,
      resolvedAgentId,
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
        agentId: resolvedAgentId,
      });
    } catch (error) {
      const { errorCode, status } = this.classifyVoiceError(error);
      this.reportVoiceErrorToSentry(error, {
        provider: error instanceof VoiceProviderError ? error.provider : 'unknown',
        language: dto.languageHint ?? 'unknown',
        agentId: resolvedAgentId,
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
      // STT couldn't extract clear speech. Could be noisy audio, mumbled input, or a
      // too-short recording — we don't differentiate; one generic message keeps copy simple.
      res.status(HttpStatus.UNPROCESSABLE_ENTITY);
      return {
        error: true,
        errorCode: voiceErrorCodes.NO_SPEECH_DETECTED,
        message: "We couldn't make that out. Please try again from a quieter spot.",
      };
    }

    // Streaming-only path. Clients MUST send Accept: application/x-ndjson.
    // Branches into direct-mode (no webhook needed) or n8n-mode (webhook URL
    // required) based on the agent's aiConfig.routingMode. Legacy non-streaming
    // fallback was removed — every voice consumer uses streaming exclusively.
    const clientAcceptsNdjson = req.headers['accept']?.includes('application/x-ndjson');
    if (!clientAcceptsNdjson) {
      res.status(HttpStatus.NOT_ACCEPTABLE);
      return {
        error: true,
        errorCode: voiceErrorCodes.PROVIDER_UNAVAILABLE,
        message: 'Voice conversation requires a streaming-capable client (Accept: application/x-ndjson).',
      };
    }

    // Resolve full agent for routing-mode + aiConfig inspection. ChatService.resolveAgent
    // returns a stripped projection, so we hit the DB again for the full record.
    // Cheap query (PK lookup) and only runs on the voice endpoint.
    const fullAgent = await this.prisma.agent.findUniqueOrThrow({
      where: { id: resolvedAgentId },
    });
    const routingMode = resolveRoutingMode(fullAgent.aiConfig);

    let webhookUrl: string | null = null;
    if (routingMode === 'n8n') {
      try {
        webhookUrl = await this.agentsService.getEffectiveWebhookUrl(resolvedAgentId);
      } catch (error) {
        if (!(error instanceof NotFoundException)) {
          this.logger.error(
            `Failed to fetch webhook URL for agent ${resolvedAgentId}: ${error instanceof Error ? error.message : 'unknown'}`,
          );
        }
      }
      if (!webhookUrl) {
        res.status(HttpStatus.PRECONDITION_FAILED);
        return {
          error: true,
          errorCode: voiceErrorCodes.PROVIDER_UNAVAILABLE,
          message: 'Agent is not configured for voice conversations (no webhook URL).',
        };
      }
    }

    let voiceConfig: VoiceConfigDto;
    try {
      voiceConfig = await this.voiceService.getVoiceConfig(resolvedAgentId);
    } catch (error) {
      this.logger.warn(
        `Failed to fetch voice config for agent ${resolvedAgentId}, defaulting to TTS enabled: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      voiceConfig = { ttsEnabled: true } as VoiceConfigDto;
    }

    const visitorIp = ChatService.extractVisitorIp(req);

    // Direct-mode streaming: agent has aiConfig.routingMode = 'direct', so we
    // bypass n8n entirely and pipe DirectChatService → voice adapter → existing
    // VoiceService.streamingTTS pipeline. No webhook URL needed.
    if (routingMode === 'direct' && voiceConfig.ttsEnabled !== false) {
      await this.handleStreamingVoice(
        dto,
        sttResult,
        sttLatencyMs,
        'direct',
        fullAgent,
        null,
        voiceConfig,
        startTime,
        res,
        resolvedAgentId,
        visitorIp,
      );
      return;
    }

    if (webhookUrl && voiceConfig.ttsEnabled !== false) {
      await this.handleStreamingVoice(
        dto,
        sttResult,
        sttLatencyMs,
        'n8n',
        fullAgent,
        webhookUrl,
        voiceConfig,
        startTime,
        res,
        resolvedAgentId,
        visitorIp,
      );
      return;
    }

    // TTS disabled or no valid routing — return error (legacy sequential path removed)
    res.status(HttpStatus.PRECONDITION_FAILED);
    return {
      error: true,
      errorCode: voiceErrorCodes.PROVIDER_UNAVAILABLE,
      message: 'Voice conversation requires TTS-enabled agent with a routing configuration.',
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

    const agent = await this.chatService.resolveAgent(dto.agentId);
    const resolvedAgentId = agent.id;

    const deviceId = this.messageRateLimitService.getDeviceIdentifier(req);
    const rateLimitResult = await this.messageRateLimitService.checkMessageRateLimit(
      deviceId,
      resolvedAgentId,
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
        agentId: resolvedAgentId,
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
        agentId: resolvedAgentId,
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
    const agent = await this.chatService.resolveAgent(dto.agentId);
    const resolvedAgentId = agent.id;

    const deviceId = this.messageRateLimitService.getDeviceIdentifier(req);
    const rateLimitResult = await this.messageRateLimitService.checkMessageRateLimit(
      deviceId,
      resolvedAgentId,
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
        agentId: resolvedAgentId,
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
        agentId: resolvedAgentId,
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
    mode: 'n8n' | 'direct',
    fullAgent: Awaited<ReturnType<PrismaService['agent']['findUniqueOrThrow']>>,
    webhookUrl: string | null,
    voiceConfig: VoiceConfigDto,
    startTime: number,
    res: Response,
    resolvedAgentId: string,
    visitorIp?: string,
  ): Promise<void> {
    // Resolve session for message storage
    const session = await this.chatService.resolveOrCreateSession(resolvedAgentId, dto.sessionId, dto.source ?? 'WIDGET', visitorIp);
    const userMessage = await this.chatService.saveUserMessage(session.id, sttResult.transcript);

    // Set chunked response headers
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Session-Id', session.id);
    res.setHeader('X-Message-Id', userMessage.id);

    // Send transcription chunk immediately so the client can show the user's message
    const transcriptionChunk = {
      type: 'transcription' as const,
      text: sttResult.transcript,
      detectedLanguage: sttResult.detectedLanguage,
      confidence: sttResult.confidence,
      sttLatencyMs,
    };
    res.write(JSON.stringify(transcriptionChunk) + '\n');

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

    // Build the token stream from either direct-mode LLM or the legacy n8n
    // webhook, depending on the agent's routing mode. Both sources yield
    // chunks in N8nStreamChunk format (the direct-mode path adapts via
    // directChatToN8nStream) so the downstream voice pipeline is unchanged.
    let tokenStream: AsyncGenerator<N8nStreamChunk>;
    if (mode === 'direct') {
      const directStream = this.directChatService.stream({
        agent: fullAgent,
        chatSessionId: session.id,
        externalSessionId: session.sessionId,
        newUserMessage: sttResult.transcript,
        feature: 'voice',
        abortSignal: abortController.signal,
      });
      tokenStream = directChatToN8nStream(directStream);
    } else {
      if (!webhookUrl) {
        // Should never happen — routing mode was 'n8n' but webhookUrl absent.
        // Defensive: surface a clear error rather than crashing mid-stream.
        throw new Error(
          'handleStreamingVoice called in n8n mode without a webhookUrl',
        );
      }
      tokenStream = this.n8nStreamingService.streamFromWebhookUrl(
        webhookUrl,
        sttResult.transcript,
        session.sessionId,
        abortController.signal,
      );
    }

    const ttsLatencies: number[] = [];
    let fullText = '';
    let totalSentences = 0;
    let timeToFirstChunkMs: number | null = null;

    try {
      const voiceStream = this.voiceService.streamingTTS(
        tokenStream,
        sttResult.detectedLanguage,
        resolvedAgentId,
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
          `Streaming voice failed for agent ${resolvedAgentId}: ${error instanceof Error ? error.message : 'unknown'}`,
        );
        this.reportVoiceErrorToSentry(error, {
          provider: 'streaming',
          language: sttResult.detectedLanguage,
          agentId: resolvedAgentId,
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
        // Keep ChatSession.lastMessageAt in lockstep with the text flow so
        // voice sessions sort alongside widget chats on the dashboard
        // Conversations list. Without this, voice sessions stay null forever.
        this.chatService.updateSessionTimestamp(session.id),
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
