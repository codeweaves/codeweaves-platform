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
import { MessageMetricsService } from '../../services/message-metrics.service';
import { N8nStreamingService } from '../../services/n8n-streaming.service';
import { AgentsService } from '../../services/agents.service';
import { PrismaService } from '../../services/prisma.service';
import { MessageRateLimitService } from '../../services/message-rate-limit.service';
import { DirectChatService } from '../ai/direct-chat.service';
import type { DirectChatResult } from '../ai/interfaces/direct-chat.interfaces';
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
    private readonly messageMetricsService: MessageMetricsService,
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

    // Send transcription chunk immediately so the client can show the user's message.
    // Includes `sessionId` (external public id) so multi-turn voice clients can
    // round-trip it on the next request — without this, every voice call creates
    // a fresh session instead of appending to the conversation.
    const transcriptionChunk = {
      type: 'transcription' as const,
      sessionId: session.sessionId,
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
    //
    // For direct mode, we also capture the LLM's per-turn result (ttftMs,
    // tokens, cost, model, finishReason) via the adapter's onFinish callback
    // so we can persist them into the assistant-message metadata below — that
    // gives analytics a full STT/LLM/TTS breakdown per voice turn instead of
    // only the aggregate timings.
    let tokenStream: AsyncGenerator<N8nStreamChunk>;
    let llmResult: DirectChatResult | null = null;
    if (mode === 'direct') {
      const directStream = this.directChatService.stream({
        agent: fullAgent,
        chatSessionId: session.id,
        externalSessionId: session.sessionId,
        newUserMessage: sttResult.transcript,
        feature: 'voice',
        abortSignal: abortController.signal,
      });
      tokenStream = directChatToN8nStream(directStream, (r) => {
        llmResult = r;
      });
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
    // Track WS-specific metrics across all sentences when streaming was used.
    // We aggregate then write into the assistant-message metadata so analytics
    // can compare batch vs WS performance per turn.
    const wsFirstChunkLatencies: number[] = [];
    const wsChunkCounts: number[] = [];
    let wsTotalBytes = 0;
    const ttsProtocols = new Set<'http' | 'websocket'>();
    const ttsProviders = new Set<string>();
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
          // `timeToFirstChunkMs` = when the user first hears ANY audio. With
          // per-chunk WS delivery this lands EARLIER than before (first audio
          // bytes of the first sentence) — that's the perceptual win we're
          // measuring.
          if (timeToFirstChunkMs === null) {
            timeToFirstChunkMs = Date.now() - startTime;
          }
          if (chunk.ttsProtocol) ttsProtocols.add(chunk.ttsProtocol);
          if (chunk.ttsProvider) ttsProviders.add(chunk.ttsProvider);
          // First-chunk + final-chunk markers carry the per-sentence WS
          // diagnostics. Aggregate across the turn.
          if (chunk.wsFirstChunkLatencyMs !== undefined) {
            wsFirstChunkLatencies.push(chunk.wsFirstChunkLatencyMs);
          }
          if (chunk.isFinalChunk) {
            // Per-sentence totals are only meaningful on the LAST chunk —
            // that's when sentence-level latency is settled.
            ttsLatencies.push(chunk.ttsLatencyMs);
            if (chunk.wsChunkCount !== undefined) wsChunkCounts.push(chunk.wsChunkCount);
            if (chunk.wsTotalBytes !== undefined) wsTotalBytes += chunk.wsTotalBytes;
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

    // Pull LLM metrics off the direct-mode result if present. We spread these
    // into the metadata at the top level (rather than nesting under `llm:`) so
    // existing analytics queries that look for `model` / `ttftMs` / `cost` on
    // text messages also work for voice messages.
    const llmMetadata: Record<string, unknown> =
      mode === 'direct' && llmResult
        ? {
            model: (llmResult as DirectChatResult).model,
            llmTtftMs: (llmResult as DirectChatResult).ttftMs,
            llmLatencyMs: (llmResult as DirectChatResult).latencyMs,
            inputTokens: (llmResult as DirectChatResult).usage.inputTokens,
            outputTokens: (llmResult as DirectChatResult).usage.outputTokens,
            totalTokens: (llmResult as DirectChatResult).usage.totalTokens,
            cachedInputTokens:
              (llmResult as DirectChatResult).usage.cachedInputTokens ?? null,
            reasoningTokens:
              (llmResult as DirectChatResult).usage.reasoningTokens ?? null,
            cost: (llmResult as DirectChatResult).cost,
            finishReason: (llmResult as DirectChatResult).finishReason,
            traceId: (llmResult as DirectChatResult).traceId,
            historyCount: (llmResult as DirectChatResult).historyCount,
            historyTruncated: (llmResult as DirectChatResult).historyTruncated,
          }
        : {};

    // Aggregate WS-specific metrics across all sentences. Mixed-transport
    // turns (some sentences streamed, some fell back to batch) are reported
    // with `ttsProtocol: 'mixed'` so analytics can spot the failure-fallback
    // pattern.
    const wsAvgFirstChunkLatencyMs =
      wsFirstChunkLatencies.length > 0
        ? Math.round(
            wsFirstChunkLatencies.reduce((a, b) => a + b, 0) /
              wsFirstChunkLatencies.length,
          )
        : null;
    const wsTotalChunks =
      wsChunkCounts.length > 0
        ? wsChunkCounts.reduce((a, b) => a + b, 0)
        : null;
    const ttsProtocol: 'http' | 'websocket' | 'mixed' | null =
      ttsProtocols.size === 0
        ? null
        : ttsProtocols.size === 1
          ? (ttsProtocols.values().next().value as 'http' | 'websocket')
          : 'mixed';
    // Which provider(s) actually synthesized this turn: a single name, or
    // 'mixed' when a sentence fell back from one provider to another.
    const ttsProvider: string | null =
      ttsProviders.size === 0
        ? null
        : ttsProviders.size === 1
          ? (ttsProviders.values().next().value as string)
          : 'mixed';

    const metadata = {
      inputType: 'voice' as const,
      streaming: true,
      routingMode: mode,
      detectedLanguage: sttResult.detectedLanguage,
      languageConfidence: sttResult.confidence,
      sttProvider: sttResult.provider ?? null,
      sttLatencyMs,
      totalSentences,
      averageTtsLatencyMs,
      timeToFirstChunkMs,
      totalLatencyMs: Date.now() - startTime,
      // WS-streaming TTS instrumentation. Null/absent on batch-only turns so
      // existing analytics queries that COALESCE these to 0 still work.
      ttsProtocol,
      ttsProvider,
      wsAvgFirstChunkLatencyMs,
      wsTotalChunks,
      wsTotalBytes: wsTotalBytes > 0 ? wsTotalBytes : null,
      ...llmMetadata,
    };

    const userMetadata = {
      inputType: 'voice' as const,
      detectedLanguage: sttResult.detectedLanguage,
      languageConfidence: sttResult.confidence,
      sttProvider: sttResult.provider ?? 'unknown',
      sttLatencyMs,
    };
    try {
      await Promise.all([
        fullText
          ? this.chatService.saveAssistantMessage(session.id, fullText, metadata)
          : this.chatService.saveAssistantMessage(session.id, '[streaming failed]', { ...metadata, error: true }),
        this.prisma.chatMessage.update({
          where: { id: userMessage.id },
          data: { metadata: userMetadata },
        }),
        // Mirror the voice USER message's STT metrics into typed columns so
        // analytics counts it as a voice turn (and tracks the STT provider).
        this.messageMetricsService.recordFromMetadata(userMessage.id, userMessage.createdAt, userMetadata),
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
